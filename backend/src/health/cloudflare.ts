import { z } from "zod";
import { request, type Fetch } from "./source.js";

/**
 * The trigger Worker's invocations, from Cloudflare's GraphQL Analytics API, matched against the
 * crons in its wrangler.jsonc.
 *
 * A failed invocation is the dispatch to GitHub failing all three attempts. A missing one is a
 * cron Cloudflare never fired, which the Worker cannot report about itself — the reason to look
 * from outside.
 *
 * Read from `workersInvocationsAdaptive` per minute, not from `workersInvocationsScheduled`: on
 * this account (free plan) the scheduled dataset answers empty while the general one has every
 * cron run. The Worker has no route, so every invocation it counts is a cron; the cron each one
 * answered is inferred from its minute.
 */

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
/** A slot younger than this may still be running or not yet aggregated. */
const SLOT_GRACE_MS = 15 * 60_000;
/** How far an invocation may land from its slot and still count as that slot. */
const SLOT_MATCH_MS = 5 * 60_000;

const QUERY = `query PulsoHealth($account: String!, $script: String!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(
        limit: 10000
        filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }
        orderBy: [datetimeMinute_ASC]
      ) {
        sum { requests }
        dimensions { datetimeMinute status }
      }
    }
  }
}`;

const rowSchema = z.object({
  sum: z.object({ requests: z.number() }),
  dimensions: z.object({ datetimeMinute: z.string(), status: z.string() }),
});

const responseSchema = z.object({
  data: z
    .object({
      viewer: z.object({
        accounts: z.array(z.object({ workersInvocationsAdaptive: z.array(rowSchema) })),
      }),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ message: z.string() })).nullable().optional(),
});

/** The daily cron (`M H * * *`, UTC) whose time of day is within SLOT_MATCH_MS of `iso`. */
export function cronAt(crons: readonly string[], iso: string): string | null {
  const at = new Date(iso);
  const minuteOfDay = at.getUTCHours() * 60 + at.getUTCMinutes();
  for (const cron of crons) {
    const match = DAILY_CRON.exec(cron.trim());
    if (!match) continue;
    const slot = Number(match[2]) * 60 + Number(match[1]);
    const distance = Math.min(Math.abs(minuteOfDay - slot), 1440 - Math.abs(minuteOfDay - slot));
    if (distance * 60_000 <= SLOT_MATCH_MS) return cron;
  }
  return null;
}

export interface Invocation {
  datetime: string;
  scheduledAt: string | null;
  cron: string | null;
  status: string;
}

export interface CronSlot {
  cron: string;
  scheduledAt: string;
  /**
   * `before`: earlier than the first invocation of this cron in the window, while the cron has
   * fired since — a Worker deployed (or a cron added) mid-window, not a missing run. A cron that
   * never fired in the whole window has all its slots `missing`.
   */
  state: "ok" | "failed" | "missing" | "before";
  /** Cloudflare's status of the matching invocation. */
  status?: string;
}

export interface CloudflareData {
  worker: string;
  crons: string[];
  from: string;
  to: string;
  slots: CronSlot[];
  /** Invocations that match no cron slot: a manual trigger from the dashboard, an old cron. */
  unmatched: Invocation[];
  /** Set when Cloudflare refused the older part of the window; `from` is then where data starts. */
  limit?: string;
}

const DAILY_CRON = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/;

/**
 * Every slot of the daily crons (`M H * * *`, UTC, as Cloudflare reads them) inside the window,
 * each marked by the invocation that answered it. Other cron shapes are not expanded.
 */
export function cronSlots(
  crons: readonly string[],
  invocations: readonly Invocation[],
  from: Date,
  to: Date
): { slots: CronSlot[]; unmatched: Invocation[] } {
  const used = new Set<Invocation>();
  const slots: CronSlot[] = [];
  const lastSlot = to.getTime() - SLOT_GRACE_MS;

  for (const cron of crons) {
    const match = DAILY_CRON.exec(cron.trim());
    if (!match) continue;
    const minute = Number(match[1]);
    const hour = Number(match[2]);
    const firstFired = invocations
      .filter((invocation) => invocation.cron === cron)
      .reduce((first, invocation) => Math.min(first, Date.parse(invocation.scheduledAt ?? invocation.datetime)), Infinity);
    const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    for (; day.getTime() <= to.getTime(); day.setUTCDate(day.getUTCDate() + 1)) {
      const slot = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute);
      if (slot < from.getTime() || slot > lastSlot) continue;
      const hit = invocations.find((invocation) => {
        if (used.has(invocation) || invocation.cron !== cron) return false;
        const at = Date.parse(invocation.scheduledAt ?? invocation.datetime);
        return Math.abs(at - slot) <= SLOT_MATCH_MS;
      });
      if (hit) used.add(hit);
      const state: CronSlot["state"] = hit
        ? hit.status === "success"
          ? "ok"
          : "failed"
        : Number.isFinite(firstFired) && slot < firstFired - SLOT_MATCH_MS
          ? "before"
          : "missing";
      slots.push({
        cron,
        scheduledAt: new Date(slot).toISOString(),
        state,
        ...(hit ? { status: hit.status } : {}),
      });
    }
  }

  slots.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return { slots, unmatched: invocations.filter((invocation) => !used.has(invocation)) };
}

/**
 * The free plan answers at most one week per query ("cannot request a time range wider than 1w"),
 * so the window is asked for in pieces a minute short of that.
 */
export const CHUNK_MS = 7 * 24 * 60 * 60_000 - 60_000;

/** The window split into pieces of at most CHUNK_MS, newest first. */
export function chunks(from: Date, to: Date): Array<{ from: Date; to: Date }> {
  const pieces: Array<{ from: Date; to: Date }> = [];
  for (let end = to.getTime(); end > from.getTime(); end -= CHUNK_MS) {
    pieces.push({ from: new Date(Math.max(from.getTime(), end - CHUNK_MS)), to: new Date(end) });
  }
  return pieces;
}

async function queryInvocations(
  input: { accountId: string; token: string; worker: string; crons: readonly string[]; fetchImpl?: Fetch },
  from: Date,
  to: Date
): Promise<Invocation[]> {
  const response = await request(input.fetchImpl ?? fetch, "Cloudflare", GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      "User-Agent": "pulso-health",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { account: input.accountId, script: input.worker, from: from.toISOString(), to: to.toISOString() },
    }),
  });
  const body = responseSchema.parse(await response.json());
  if (body.errors && body.errors.length > 0) {
    throw new Error(`Cloudflare: ${body.errors.map((error) => error.message).join("; ")}`);
  }
  const accounts = body.data?.viewer.accounts ?? [];
  if (accounts.length === 0) throw new Error("Cloudflare: conta não encontrada, ou o token não tem acesso a ela");
  // One row per minute and status; `requests` above 1 means several runs in that minute.
  return accounts[0].workersInvocationsAdaptive.flatMap((row) =>
    Array.from({ length: row.sum.requests }, () => ({
      datetime: row.dimensions.datetimeMinute,
      scheduledAt: null,
      cron: cronAt(input.crons, row.dimensions.datetimeMinute),
      status: row.dimensions.status,
    }))
  );
}

export async function collectCloudflare(input: {
  accountId: string;
  token: string;
  worker: string;
  crons: readonly string[];
  from: Date;
  to: Date;
  fetchImpl?: Fetch;
}): Promise<CloudflareData> {
  const invocations: Invocation[] = [];
  let coveredFrom = input.to;
  let limit: string | undefined;

  for (const piece of chunks(input.from, input.to)) {
    try {
      invocations.push(...(await queryInvocations(input, piece.from, piece.to)));
      coveredFrom = piece.from;
    } catch (error) {
      // The newest week failing is a real error. An older one failing is the plan's retention:
      // keep what came back and say how far it reaches.
      if (coveredFrom === input.to) throw error;
      limit = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  const { slots, unmatched } = cronSlots(input.crons, invocations, coveredFrom, input.to);
  return {
    worker: input.worker,
    crons: [...input.crons],
    from: coveredFrom.toISOString(),
    to: input.to.toISOString(),
    slots,
    unmatched,
    ...(limit ? { limit } : {}),
  };
}
