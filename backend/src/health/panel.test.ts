import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../edition/paths.js";
import { summarizeCost } from "./aggregate.js";
import { parseDays, repoFromRemote, resolveSettings, secretValues, workerFromWrangler } from "./config.js";
import { escapeHtml, PAGE_CSP, renderHealthPage, type HealthSnapshot } from "./render.js";
import { collect, redact } from "./source.js";
import { report, run } from "./testFixtures.js";

describe("summarizeCost", () => {
  const now = new Date("2026-11-02T15:00:00Z");
  const since = new Date("2026-10-03T15:00:00Z");

  it("adds up the window, the month in Brasília and the cost per published edition", () => {
    const runs = [
      run({ id: 3, createdAt: "2026-11-02T10:32:00Z", reports: [report({ date: "2026-11-02", usd: 0.4 })] }),
      // 00:30 UTC on 1 Nov is still 31 Oct in Brasília: last month.
      run({
        id: 2,
        createdAt: "2026-11-01T00:30:00Z",
        reports: [report({ date: "2026-11-01", usd: 0.1, startedAt: "2026-11-01T00:30:00.000Z" })],
      }),
      run({
        id: 1,
        createdAt: "2026-11-01T12:00:00Z",
        conclusion: "failure",
        reports: [
          report({
            date: "2026-11-01",
            usd: 0.05,
            outcome: "failed",
            jobs: [{ kind: "edition", status: "error", editionId: null, newItemCount: 0, skippedReason: null, costUsd: 0.05 }],
          }),
        ],
      }),
    ];

    const summary = summarizeCost(runs, { since, now });

    expect(summary.windowUsd).toBe(0.55);
    expect(summary.monthUsd).toBe(0.45);
    expect(summary.publishedEditions).toBe(2);
    // The failed run's spend is part of what each published edition cost.
    expect(summary.perEditionUsd).toBe(0.275);
    expect(summary.failedRuns).toBe(1);
    expect(summary.priciest?.usd).toBe(0.4);
    expect(summary.bySteps.map((row) => row.key)).toEqual(["editorial", "worker"]);
    expect(summary.days.slice(0, 3).map((day) => [day.date, day.edition, day.usd])).toEqual([
      ["2026-11-02", "published", 0.4],
      ["2026-11-01", "failed", 0.05],
      ["2026-10-31", "published", 0.1],
    ]);
  });

  it("says nothing it has no report for", () => {
    const summary = summarizeCost([run({ reports: [] })], { since, now });
    expect(summary.windowUsd).toBeNull();
    expect(summary.monthUsd).toBeNull();
    expect(summary.perEditionUsd).toBeNull();
    expect(summary.priciest).toBeNull();
    expect(summary.runsWithoutReport).toBe(1);
    expect(summary.days.every((day) => day.usd === null && day.edition === null)).toBe(true);
  });

  it("leaves the month blank when the window starts after its first day", () => {
    const summary = summarizeCost([run({ createdAt: "2026-11-10T10:32:00Z", reports: [report({ date: "2026-11-10" })] })], {
      since: new Date("2026-11-05T12:00:00Z"),
      now: new Date("2026-11-30T12:00:00Z"),
    });
    expect(summary.windowUsd).toBe(0.31);
    expect(summary.monthUsd).toBeNull();
  });

  it("flags models without a price", () => {
    const withUnpriced = report();
    withUnpriced.cost.entries.push({ step: "audit", model: "modelo-novo", inputTokens: 1, outputTokens: 1, webSearchCalls: 0, usd: 0, priced: false });
    withUnpriced.cost.unpricedModels = ["modelo-novo"];
    const summary = summarizeCost([run({ reports: [withUnpriced] })], { since, now });
    expect(summary.unpricedModels).toEqual(["modelo-novo"]);
    expect(summary.byModels.find((row) => row.key === "modelo-novo")?.priced).toBe(false);
  });
});

describe("settings", () => {
  const base = { argv: [], root: "/repo", cwd: "/repo/backend", ghToken: () => undefined };

  it("reads the repository from either remote form", () => {
    expect(repoFromRemote("https://github.com/exemplo/pulso.git")).toBe("exemplo/pulso");
    expect(repoFromRemote("git@github.com:exemplo/pulso.git\n")).toBe("exemplo/pulso");
    expect(repoFromRemote("https://gitlab.com/exemplo/pulso")).toBeUndefined();
  });

  it("reads the Worker name and crons from the real wrangler.jsonc", () => {
    const worker = workerFromWrangler(readFileSync(path.join(repoRoot(), "infra", "disparador", "wrangler.jsonc"), "utf8"));
    expect(worker.name).toBe("pulso-disparador");
    expect(worker.crons.length).toBeGreaterThan(0);
    expect(worker.crons.every((cron) => cron.split(" ").length === 5)).toBe(true);
  });

  it("prefers .env.health over the shell, and ignores unprefixed tokens", () => {
    const settings = resolveSettings({
      ...base,
      env: { CLOUDFLARE_API_TOKEN: "amplo", GITHUB_TOKEN: "amplo", PULSO_HEALTH_HEALTHCHECKS_KEY: "do-shell" },
      envFile: { PULSO_HEALTH_HEALTHCHECKS_KEY: "do-arquivo", PULSO_HEALTH_CLOUDFLARE_TOKEN: " " },
    });
    expect(settings.healthchecks.apiKey).toBe("do-arquivo");
    expect(settings.cloudflare.token).toBeUndefined();
    expect(settings.github.token).toBeUndefined();
    const blankLine = resolveSettings({ ...base, env: { PULSO_HEALTH_REPO: "exemplo/pulso" }, envFile: { PULSO_HEALTH_REPO: "" } });
    expect(blankLine.github.repo).toBe("exemplo/pulso");
  });

  it("asks gh for a token only when none is configured", () => {
    let asked = 0;
    const ghToken = () => {
      asked += 1;
      return "do-gh";
    };
    expect(resolveSettings({ ...base, ghToken, env: {}, envFile: { PULSO_HEALTH_GITHUB_TOKEN: "pat" } }).github.token).toBe("pat");
    expect(asked).toBe(0);
    expect(resolveSettings({ ...base, ghToken, env: {}, envFile: {} }).github.token).toBe("do-gh");
  });

  it("resolves --out from where the command was typed", () => {
    const settings = resolveSettings({ ...base, argv: ["--out", "painel"], env: {}, envFile: {} });
    expect(settings.outDir).toBe("/repo/backend/painel");
    expect(resolveSettings({ ...base, env: {}, envFile: {} }).outDir).toBe("/repo/.tmp/health");
  });

  it("bounds --days to what every source can answer", () => {
    expect(parseDays([])).toBe(30);
    expect(parseDays(["--days", "7"])).toBe(7);
    expect(() => parseDays(["--days", "31"])).toThrow();
    expect(() => parseDays(["--days=0"])).toThrow();
  });
});

describe("renderHealthPage", () => {
  const generatedAt = "2026-10-24T15:00:00.000Z";
  const since = "2026-09-24T15:00:00.000Z";
  const sentinel = "valor-sentinela-do-teste";

  function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
    return {
      generatedAt,
      since,
      days: 30,
      github: { state: "ok", data: { repo: "exemplo/pulso", workflow: "publicar.yml", runs: [run()] } },
      healthchecks: {
        state: "ok",
        data: {
          checks: [
            { name: "Pulso: edição", status: "up", lastPing: "2026-10-24T10:43:00Z", nextPing: "2026-10-25T10:30:00Z", graceSeconds: 14400, schedule: "30 10 * * * (UTC)" },
          ],
        },
      },
      cloudflare: {
        state: "ok",
        data: {
          worker: "pulso-disparador",
          crons: ["32 10 * * *"],
          from: since,
          to: generatedAt,
          slots: [
            { cron: "32 10 * * *", scheduledAt: "2026-10-23T10:32:00.000Z", state: "missing" },
            { cron: "32 10 * * *", scheduledAt: "2026-10-24T10:32:00.000Z", state: "ok", status: "success" },
          ],
          unmatched: [],
        },
      },
      ...overrides,
    };
  }

  it("is a page with no script and a policy that forbids one", () => {
    const page = renderHealthPage(snapshot());
    expect(page).toContain(`content="${PAGE_CSP}"`);
    expect(PAGE_CSP).toContain("default-src 'none'");
    expect(page).not.toMatch(/<script/i);
    expect(page).toContain('<html lang="pt-BR">');
  });

  it("shows the cost, the runs, the monitors and the Worker slots", () => {
    const page = renderHealthPage(snapshot());
    expect(page).toMatch(/US\$\s0,31/);
    expect(page).toContain("publicada");
    expect(page).toContain("no ar");
    expect(page).toContain("faltou");
    expect(page).toContain("07:32");
    expect(page).toContain('href="https://github.com/exemplo/pulso/actions/runs/1001"');
  });

  it("escapes everything that comes from outside", () => {
    const hostile = '<script>alert("x")</script>';
    const page = renderHealthPage(
      snapshot({
        healthchecks: {
          state: "ok",
          data: { checks: [{ name: hostile, status: hostile, lastPing: null, nextPing: null, graceSeconds: 0, schedule: hostile }] },
        },
        cloudflare: { state: "error", message: hostile },
      })
    );
    expect(page).not.toContain(hostile);
    expect(page).toContain(escapeHtml(hostile));
  });

  it("links only to GitHub", () => {
    const page = renderHealthPage(
      snapshot({ github: { state: "ok", data: { repo: "exemplo/pulso", workflow: "publicar.yml", runs: [run({ url: "javascript:alert(1)" })] } } })
    );
    expect(page).not.toContain("javascript:");
  });

  it("names the settings a missing source needs, and shows unknown numbers as a dash", () => {
    const page = renderHealthPage(
      snapshot({
        github: { state: "missing", missing: ["PULSO_HEALTH_GITHUB_TOKEN (ou gh auth login)"] },
        healthchecks: { state: "missing", missing: ["PULSO_HEALTH_HEALTHCHECKS_KEY"] },
        cloudflare: { state: "missing", missing: ["PULSO_HEALTH_CLOUDFLARE_ACCOUNT_ID", "PULSO_HEALTH_CLOUDFLARE_TOKEN"] },
      })
    );
    expect(page).toContain("<code>PULSO_HEALTH_HEALTHCHECKS_KEY</code>");
    expect(page).toContain("<code>PULSO_HEALTH_CLOUDFLARE_TOKEN</code>");
    expect(page).toContain("<dd>—</dd>");
    expect(page).not.toMatch(/US\$\s0,00/);
  });

  it("never prints a credential, even one an error message quoted", async () => {
    const settings = resolveSettings({
      argv: [],
      root: "/repo",
      cwd: "/repo",
      env: {},
      envFile: { PULSO_HEALTH_CLOUDFLARE_TOKEN: sentinel, PULSO_HEALTH_HEALTHCHECKS_KEY: `${sentinel}-hc` },
      ghToken: () => undefined,
    });
    const cloudflare = await collect([], secretValues(settings), () => Promise.reject(new Error(`token ${sentinel} recusado`)));
    const page = renderHealthPage(snapshot({ cloudflare }));
    expect(page).not.toContain(sentinel);
    expect(redact(`a ${sentinel} b`, [sentinel])).toBe("a ••• b");
  });
});
