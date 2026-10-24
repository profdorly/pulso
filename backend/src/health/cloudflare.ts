import { z } from "zod";
import { request, type Fetch } from "./source.js";

/**
 * The trigger Worker's scheduled invocations, from Cloudflare's GraphQL Analytics API, matched
 * against the crons in its wrangler.jsonc.
 *
 * A failed invocation is the dispatch to GitHub failing all three attempts. A missing one is a
 * cron Cloudflare never fired, which the Worker cannot report about itself — the reason to look
 * from outside.
 */

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
/** A slot younger than this may still be running or not yet aggregated. */
const SLOT_GRACE_MS = 15 * 60_000;
/** How far an invocation may land from its slot and still count as that slot. */
const SLOT_MATCH_MS = 5 * 60_000;

const QUERY = `query PulsoHealth($account: String!, $script: String!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsScheduled(
        limit: 10000
        filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }
        orderBy: [datetime_ASC]
      ) {
        datetime
        scheduledDatetime
        cron
        status
      }
    }
  }
}`;

const invocationSchema = z.object({
  datetime: z.string(),
  scheduledDatetime: z.string().nullable().optional(),
  cron: z.string().nullable().optional(),
  status: z.string(),
});

const responseSchema = z.object({
  data: z
    .object({
      viewer: z.object({
        accounts: z.array(z.object({ workersInvocationsScheduled: z.array(invocationSchema) })),
      }),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ message: z.string() })).nullable().optional(),
});

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

export async function collectCloudflare(input: {
  accountId: string;
  token: string;
  worker: string;
  crons: readonly string[];
  from: Date;
  to: Date;
  fetchImpl?: Fetch;
}): Promise<CloudflareData> {
  const response = await request(input.fetchImpl ?? fetch, "Cloudflare", GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      "User-Agent": "pulso-health",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        account: input.accountId,
        script: input.worker,
        from: input.from.toISOString(),
        to: input.to.toISOString(),
      },
    }),
  });
  const body = responseSchema.parse(await response.json());
  if (body.errors && body.errors.length > 0) {
    throw new Error(`Cloudflare: ${body.errors.map((error) => error.message).join("; ")}`);
  }
  const accounts = body.data?.viewer.accounts ?? [];
  if (accounts.length === 0) throw new Error("Cloudflare: conta não encontrada, ou o token não tem acesso a ela");

  const invocations: Invocation[] = accounts[0].workersInvocationsScheduled.map((row) => ({
    datetime: row.datetime,
    scheduledAt: row.scheduledDatetime ?? null,
    cron: row.cron ?? null,
    status: row.status,
  }));
  const { slots, unmatched } = cronSlots(input.crons, invocations, input.from, input.to);
  return {
    worker: input.worker,
    crons: [...input.crons],
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    slots,
    unmatched,
  };
}
