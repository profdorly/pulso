import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { collectCloudflare, cronAt, cronSlots, type Invocation } from "./cloudflare.js";
import { artifactText, collectGithub } from "./github.js";
import { collectHealthchecks } from "./healthchecks.js";
import { collect, request } from "./source.js";
import { fakeFetch, json, report } from "./testFixtures.js";

/** A one-entry zip as a streaming writer makes it: sizes only after the data and in the directory. */
function streamedZip(name: string, content: string): Buffer {
  const raw = Buffer.from(content);
  const data = deflateRawSync(raw);
  const fileName = Buffer.from(name);
  const extra = Buffer.from([1, 2, 3, 4]);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(0x0008, 6); // sizes follow the data
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt16LE(extra.length, 28);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(data.length, 8);
  descriptor.writeUInt32LE(raw.length, 12);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + fileName.length, 12);
  eocd.writeUInt32LE(local.length + fileName.length + extra.length + data.length + descriptor.length, 16);
  return Buffer.concat([local, fileName, extra, data, descriptor, central, fileName, eocd]);
}

describe("request", () => {
  it("tries a 5xx again and gives up with a clear message after three tries", async () => {
    let calls = 0;
    const flaky: typeof fetch = () => Promise.resolve(new Response("", { status: calls++ < 2 ? 502 : 200 }));
    expect((await request(flaky, "GitHub", "https://api.github.com/x", {}, [0, 0])).status).toBe(200);
    expect(calls).toBe(3);

    const down: typeof fetch = () => Promise.resolve(new Response("", { status: 502 }));
    await expect(request(down, "GitHub", "https://api.github.com/x", {}, [0, 0])).rejects.toThrow(
      "GitHub respondeu HTTP 502 (falha do lado do GitHub, mesmo depois de 3 tentativas"
    );
  });

  it("does not retry a 4xx, and retries a network error", async () => {
    let calls = 0;
    const denied: typeof fetch = () => {
      calls++;
      return Promise.resolve(new Response("", { status: 401 }));
    };
    await expect(request(denied, "GitHub", "https://api.github.com/x", {}, [0, 0])).rejects.toThrow("HTTP 401");
    expect(calls).toBe(1);

    let tries = 0;
    const offline: typeof fetch = () => (tries++ < 1 ? Promise.reject(new Error("ECONNRESET")) : Promise.resolve(new Response("ok")));
    expect((await request(offline, "GitHub", "https://api.github.com/x", {}, [0, 0])).ok).toBe(true);
  });
});

describe("artifactText", () => {
  it("reads an unarchived file as is and a zipped one through its directory", () => {
    const text = JSON.stringify(report());
    expect(artifactText(Buffer.from(text))).toBe(text);
    expect(artifactText(streamedZip("run-report-1.json", text))).toBe(text);
  });
});

describe("collectGithub", () => {
  const since = new Date("2026-10-20T00:00:00Z");
  const runsApi = "https://api.github.com/repos/exemplo/pulso/actions/workflows/publicar.yml/runs";
  const artifactsApi = "https://api.github.com/repos/exemplo/pulso/actions/artifacts";
  const ghRun = (id: number, created: string) => ({
    id,
    run_number: id,
    run_attempt: 1,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    created_at: created,
    run_started_at: created,
    updated_at: created,
    html_url: `https://github.com/exemplo/pulso/actions/runs/${id}`,
  });
  const artifact = (id: number, name: string, runId: number, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    expired: false,
    created_at: "2026-10-24T10:45:00Z",
    size_in_bytes: 900,
    archive_download_url: `https://api.github.com/download/${id}`,
    workflow_run: { id: runId },
    ...extra,
  });

  it("joins each run with its reports and skips other artifacts", async () => {
    const { fetch, calls } = fakeFetch([
      [runsApi, () => json({ workflow_runs: [ghRun(2, "2026-10-24T10:32:00Z"), ghRun(1, "2026-10-19T10:32:00Z")] })],
      [
        artifactsApi,
        () =>
          json({
            artifacts: [
              artifact(10, "run-report-1.json", 2),
              artifact(11, "run-report-2.json", 2),
              artifact(12, "github-pages", 2),
              artifact(13, "run-report-1.json", 2, { expired: true }),
              artifact(14, "run-report-1.json", 999),
            ],
          }),
      ],
      ["https://api.github.com/download/10", () => new Response(JSON.stringify(report({ usd: 0.2 })))],
      ["https://api.github.com/download/11", () => new Response(streamedZip("run-report-2.json", JSON.stringify(report({ usd: 0.1 }))))],
    ]);

    const data = await collectGithub({ repo: "exemplo/pulso", token: "token-de-teste", since, fetchImpl: fetch });

    // The run from before the window is dropped even though the API's date filter let it in.
    expect(data.runs.map((run) => run.id)).toEqual([2]);
    expect(data.runs[0].reports.map((entry) => entry.cost.totalUsd).sort()).toEqual([0.1, 0.2]);
    expect(calls.map((call) => call.url)).not.toContain("https://api.github.com/download/12");
    expect(calls.map((call) => call.url)).not.toContain("https://api.github.com/download/13");
    expect(calls.map((call) => call.url)).not.toContain("https://api.github.com/download/14");
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer token-de-teste");
    expect(calls[0].url).toContain(`created=${encodeURIComponent(">=2026-10-20")}`);
  });

  it("counts a report it cannot read instead of failing the source", async () => {
    const { fetch } = fakeFetch([
      [runsApi, () => json({ workflow_runs: [ghRun(2, "2026-10-24T10:32:00Z")] })],
      [artifactsApi, () => json({ artifacts: [artifact(10, "run-report-1.json", 2)] })],
      ["https://api.github.com/download/10", () => new Response(JSON.stringify({ schemaVersion: 2 }))],
    ]);
    const data = await collectGithub({ repo: "exemplo/pulso", token: "t", since, fetchImpl: fetch });
    expect(data.runs[0].reports).toEqual([]);
    expect(data.runs[0].unreadableReports).toBe(1);
  });

  it("turns an auth failure into a message without the token", async () => {
    const { fetch } = fakeFetch([[runsApi, () => json({ message: "Bad credentials token-secreto-123" }, 401)]]);
    const source = await collect([], ["token-secreto-123"], () =>
      collectGithub({ repo: "exemplo/pulso", token: "token-secreto-123", since, fetchImpl: fetch })
    );
    expect(source).toEqual({ state: "error", message: "GitHub respondeu HTTP 401 (chave inválida ou sem permissão)" });
  });
});

describe("collectHealthchecks", () => {
  it("keeps what the page shows and drops identifiers", async () => {
    const { fetch, calls } = fakeFetch([
      [
        "https://healthchecks.io/api/v3/checks/",
        () =>
          json({
            checks: [
              {
                name: "Pulso: edição",
                slug: "pulso",
                status: "up",
                last_ping: "2026-10-24T10:43:00+00:00",
                next_ping: "2026-10-25T10:30:00+00:00",
                grace: 14400,
                schedule: "30 10 * * *",
                tz: "UTC",
                unique_key: "chave-unica-sentinela",
                ping_url: "https://hc-ping.com/uuid-sentinela",
              },
            ],
          }),
      ],
    ]);

    const data = await collectHealthchecks({ apiKey: "chave-ro", fetchImpl: fetch });

    expect(data.checks).toEqual([
      {
        name: "Pulso: edição",
        status: "up",
        lastPing: "2026-10-24T10:43:00+00:00",
        nextPing: "2026-10-25T10:30:00+00:00",
        graceSeconds: 14400,
        schedule: "30 10 * * * (UTC)",
      },
    ]);
    expect(JSON.stringify(data)).not.toContain("sentinela");
    expect(new Headers(calls[0].init?.headers).get("X-Api-Key")).toBe("chave-ro");
  });
});

describe("cronSlots", () => {
  const crons = ["32 10 * * *", "15 20 * * *"];
  const at = (iso: string, cron: string, status = "success"): Invocation => ({ datetime: iso, scheduledAt: iso, cron, status });

  it("marks each slot ok, failed or missing, and keeps the rest apart", () => {
    const invocations = [
      at("2026-10-22T10:32:00Z", "32 10 * * *"),
      at("2026-10-22T20:15:00Z", "15 20 * * *"),
      at("2026-10-23T10:32:00Z", "32 10 * * *", "exceededResources"),
      at("2026-10-23T14:00:00Z", "32 10 * * *"),
    ];
    const { slots, unmatched } = cronSlots(crons, invocations, new Date("2026-10-22T00:00:00Z"), new Date("2026-10-23T21:00:00Z"));

    expect(slots.map((slot) => [slot.scheduledAt, slot.state])).toEqual([
      ["2026-10-22T10:32:00.000Z", "ok"],
      ["2026-10-22T20:15:00.000Z", "ok"],
      ["2026-10-23T10:32:00.000Z", "failed"],
      ["2026-10-23T20:15:00.000Z", "missing"],
    ]);
    expect(unmatched.map((invocation) => invocation.datetime)).toEqual(["2026-10-23T14:00:00Z"]);
  });

  it("does not count slots before a cron first fired, unless it never fired", () => {
    const window = [new Date("2026-10-20T00:00:00Z"), new Date("2026-10-22T23:00:00Z")] as const;
    const { slots } = cronSlots(["32 10 * * *", "15 20 * * *"], [at("2026-10-22T10:32:00Z", "32 10 * * *")], ...window);
    expect(slots.filter((slot) => slot.cron === "32 10 * * *").map((slot) => slot.state)).toEqual(["before", "before", "ok"]);
    expect(slots.filter((slot) => slot.cron === "15 20 * * *").map((slot) => slot.state)).toEqual(["missing", "missing", "missing"]);
  });

  it("waits 15 minutes before calling a slot missing", () => {
    const { slots } = cronSlots(["32 10 * * *"], [], new Date("2026-10-24T00:00:00Z"), new Date("2026-10-24T10:40:00Z"));
    expect(slots).toEqual([]);
  });
});

describe("cronAt", () => {
  it("names the cron a minute belongs to, a few minutes either way", () => {
    const crons = ["32 10 * * *", "5 12 * * *"];
    expect(cronAt(crons, "2026-10-24T10:32:00Z")).toBe("32 10 * * *");
    expect(cronAt(crons, "2026-10-24T12:08:00Z")).toBe("5 12 * * *");
    expect(cronAt(crons, "2026-10-24T14:00:00Z")).toBeNull();
  });
});

describe("collectCloudflare", () => {
  const input = {
    accountId: "conta-teste",
    token: "token-cf",
    worker: "pulso-disparador",
    crons: ["32 10 * * *"],
    from: new Date("2026-10-24T00:00:00Z"),
    to: new Date("2026-10-24T12:00:00Z"),
  };

  it("queries the Worker's scheduled invocations and matches them to the crons", async () => {
    const { fetch, calls } = fakeFetch([
      [
        "https://api.cloudflare.com/client/v4/graphql",
        () =>
          json({
            data: {
              viewer: {
                accounts: [
                  {
                    workersInvocationsAdaptive: [
                      { sum: { requests: 1 }, dimensions: { datetimeMinute: "2026-10-24T10:32:00Z", status: "success" } },
                    ],
                  },
                ],
              },
            },
            errors: null,
          }),
      ],
    ]);

    const data = await collectCloudflare({ ...input, fetchImpl: fetch });

    expect(data.slots).toEqual([{ cron: "32 10 * * *", scheduledAt: "2026-10-24T10:32:00.000Z", state: "ok", status: "success" }]);
    const body = JSON.parse(calls[0].init?.body as string) as { variables: Record<string, string> };
    expect(body.variables).toEqual({
      account: "conta-teste",
      script: "pulso-disparador",
      from: "2026-10-24T00:00:00.000Z",
      to: "2026-10-24T12:00:00.000Z",
    });
  });

  it("asks a week at a time, and keeps the newer weeks when an older one is refused", async () => {
    const window = { from: new Date("2026-09-24T15:00:00Z"), to: new Date("2026-10-24T15:00:00Z") };
    const bodies: Array<{ from: string; to: string }> = [];
    let call = 0;
    const fetchImpl: typeof fetch = (_url, init) => {
      bodies.push((JSON.parse(init?.body as string) as { variables: { from: string; to: string } }).variables);
      call += 1;
      return Promise.resolve(
        call <= 2
          ? json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [] }] } }, errors: null })
          : json({ data: null, errors: [{ message: "cannot request data older than 2w" }] })
      );
    };

    const data = await collectCloudflare({ ...input, ...window, fetchImpl });

    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(Date.parse(body.to) - Date.parse(body.from)).toBeLessThan(7 * 24 * 60 * 60_000);
    }
    expect(bodies[0].to).toBe(window.to.toISOString());
    expect(data.limit).toContain("older than 2w");
    expect(data.from).toBe(bodies[1].from);
  });

  it("surfaces GraphQL errors and an account the token cannot see", async () => {
    const withErrors = fakeFetch([["https://api.cloudflare.com", () => json({ data: null, errors: [{ message: "not authorized for that account" }] })]]);
    await expect(collectCloudflare({ ...input, fetchImpl: withErrors.fetch })).rejects.toThrow("not authorized for that account");

    const noAccount = fakeFetch([["https://api.cloudflare.com", () => json({ data: { viewer: { accounts: [] } }, errors: null })]]);
    await expect(collectCloudflare({ ...input, fetchImpl: noAccount.fetch })).rejects.toThrow("conta não encontrada");
  });
});
