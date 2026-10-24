import type { RunReport } from "../kitchen/runReport.js";
import type { GithubRun } from "./github.js";
import type { Fetch } from "./source.js";

/** Synthetic data for the health tests: no real account, check or run identifier. */

export function report(overrides: Partial<RunReport> & { usd?: number; date?: string } = {}): RunReport {
  const { usd = 0.31, date = "2026-10-24", ...rest } = overrides;
  return {
    schemaVersion: 1,
    startedAt: `${date}T10:32:05.000Z`,
    finishedAt: `${date}T10:41:40.000Z`,
    mode: "daily",
    outcome: "ok",
    publish: true,
    catalogue: "skipped",
    jobs: [
      { kind: "edition", status: "published", editionId: `${date}-manha`, newItemCount: 9, skippedReason: null, costUsd: usd },
    ],
    cost: {
      totalUsd: usd,
      budgetUsd: 4,
      entries: [
        { step: "worker", model: "gpt-6-luna", inputTokens: 40_000, outputTokens: 6_000, webSearchCalls: 0, usd: 0.007, priced: true },
        { step: "editorial", model: "gpt-6.1-sol", inputTokens: 90_000, outputTokens: 12_000, webSearchCalls: 0, usd: Number((usd - 0.007).toFixed(6)), priced: true },
      ],
      unpricedModels: [],
    },
    ...rest,
  };
}

export function run(overrides: Partial<GithubRun> = {}): GithubRun {
  return {
    id: 1001,
    number: 51,
    attempt: 1,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-10-24T10:32:00Z",
    startedAt: "2026-10-24T10:32:04Z",
    updatedAt: "2026-10-24T10:43:10Z",
    url: "https://github.com/exemplo/pulso/actions/runs/1001",
    reports: [report()],
    unreadableReports: 0,
    ...overrides,
  };
}

export interface FakeCall {
  url: string;
  init?: RequestInit;
}

/** A fetch that answers from `routes` by URL prefix and records every call. */
export function fakeFetch(routes: Array<[string, () => Response]>): { fetch: Fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchImpl: Fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    return Promise.resolve(route ? route[1]() : new Response("not found", { status: 404 }));
  };
  return { fetch: fetchImpl, calls };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
