// Roda com: node --test infra/disparador/src/index.test.ts
// Sem dependências: o fetch do site e do GitHub é trocado por um falso.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import worker, { todayEditionId } from "./index.ts";

const env = { GITHUB_TOKEN: "token-de-teste" };
const realFetch = globalThis.fetch;
// 10:32 UTC = 07:32 em Brasília, 31/10/2026.
const MORNING = Date.parse("2026-10-31T10:32:00Z");

function fake(site: { status?: number; edition?: string | null; throws?: boolean }) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ method: init.method ?? "GET", url, ...(typeof init.body === "string" ? { body: init.body } : {}) });
    if (url.startsWith("https://pulso.dorly.com.br/")) {
      if (site.throws) throw new TypeError("network down");
      const meta = site.edition ? `<meta name="pulso:edition" content="${site.edition}" />` : "";
      return new Response(`<html><head>${meta}</head></html>`, { status: site.status ?? 200 });
    }
    if (url.endsWith("/dispatches")) return new Response(null, { status: 204 });
    if (url.endsWith("/publicar.yml")) return Response.json({ state: "active" });
    return new Response("inesperado", { status: 500 });
  }) as typeof fetch;
  return calls;
}

const dispatched = (calls: ReturnType<typeof fake>) => calls.filter((call) => call.url.endsWith("/dispatches"));
const run = (time = MORNING) => worker.scheduled({ cron: "32 10 * * *", scheduledTime: time }, env);

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("todayEditionId", () => {
  it("uses the day in Brasília, not in UTC", () => {
    assert.equal(todayEditionId(MORNING), "2026-10-31-manha");
    // 01:00 UTC on the 1st is still the 31st in Brasília.
    assert.equal(todayEditionId(Date.parse("2026-11-01T01:00:00Z")), "2026-10-31-manha");
  });
});

describe("scheduled", () => {
  it("dispatches when the site still shows yesterday", async () => {
    const calls = fake({ edition: "2026-10-30-manha" });
    await run();
    assert.equal(dispatched(calls).length, 1);
    assert.deepEqual(JSON.parse(dispatched(calls)[0]!.body ?? "{}"), { ref: "main", inputs: { tarefa: "edicao" } });
  });

  it("does nothing when today's edition is already live", async () => {
    const calls = fake({ edition: "2026-10-31-manha" });
    await run();
    assert.equal(dispatched(calls).length, 0);
    assert.ok(!calls.some((call) => new URL(call.url).hostname === "api.github.com"), "não deve nem consultar o GitHub");
  });

  it("dispatches when the site cannot be read", async () => {
    for (const site of [{ throws: true }, { status: 503 }, { edition: null }]) {
      const calls = fake(site);
      await run();
      assert.equal(dispatched(calls).length, 1, JSON.stringify(site));
    }
  });

  it("fails loudly when GitHub refuses the dispatch", async () => {
    fake({ edition: "2026-10-30-manha" });
    const refusing = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) =>
      String(input).endsWith("/dispatches") ? new Response("Bad credentials", { status: 401 }) : refusing(input, init)) as typeof fetch;
    await assert.rejects(run(), /não foi disparado/);
  });
});
