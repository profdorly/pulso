// Roda com: node --test --experimental-strip-types infra/disparador/src/index.test.ts
// Sem dependências: o fetch do GitHub é trocado por um falso que responde como a API.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import worker, { unstick } from "./index.ts";

const NOW = Date.parse("2026-10-30T23:00:00Z");
const env = { GITHUB_TOKEN: "token-de-teste" };
const realFetch = globalThis.fetch;

interface Run {
  id: number;
  status: string;
  created_at: string;
}

function fakeGithub(runs: Run[], options: { cancelRefused?: number[] } = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ method, url, ...(typeof init.body === "string" ? { body: init.body } : {}) });
    const listed = /\/runs\?status=(\w+)/.exec(url)?.[1];
    if (listed) return Response.json({ workflow_runs: runs.filter((run) => run.status === listed) });
    const cancelled = /\/runs\/(\d+)\/cancel$/.exec(url)?.[1];
    if (cancelled) {
      const refused = options.cancelRefused?.includes(Number(cancelled));
      return new Response(refused ? '{"message":"Cannot cancel a workflow run that is completed"}' : "", { status: refused ? 409 : 202 });
    }
    if (url.endsWith("/dispatches")) return new Response(null, { status: 204 });
    if (url.endsWith("/publicar.yml")) return Response.json({ state: "active" });
    return new Response("inesperado", { status: 500 });
  }) as typeof fetch;
  return calls;
}

const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("unstick", () => {
  it("leaves a healthy queue alone", async () => {
    const calls = fakeGithub([{ id: 1, status: "waiting", created_at: ago(1) }]);
    assert.equal(await unstick(env, NOW), undefined);
    assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  });

  it("cancels a stuck run and keeps the normal queue when GitHub accepts", async () => {
    const calls = fakeGithub([
      { id: 10, status: "waiting", created_at: ago(300) },
      { id: 11, status: "pending", created_at: ago(200) },
      { id: 12, status: "pending", created_at: ago(5) },
    ]);
    assert.equal(await unstick(env, NOW), undefined);
    const cancelled = calls.filter((call) => call.url.endsWith("/cancel")).map((call) => call.url.split("/").at(-2));
    assert.deepEqual(cancelled, ["10", "11"]);
  });

  it("detours to a queue of its own when the stuck run refuses to cancel", async () => {
    fakeGithub([{ id: 40947370626, status: "waiting", created_at: ago(1800) }], { cancelRefused: [40947370626] });
    assert.equal(await unstick(env, NOW), "desvio-40947370626");
  });

  it("does not cancel runs that wait behind one that is working", async () => {
    const calls = fakeGithub(
      [
        { id: 20, status: "waiting", created_at: ago(90) },
        { id: 21, status: "in_progress", created_at: ago(50) },
        { id: 22, status: "pending", created_at: ago(45) },
      ],
      { cancelRefused: [20] }
    );
    await unstick(env, NOW);
    assert.ok(!calls.some((call) => call.url.endsWith("/22/cancel")));
  });

  it("dispatches on the normal queue if GitHub cannot be read", async () => {
    globalThis.fetch = (async () => new Response("erro", { status: 502 })) as typeof fetch;
    assert.equal(await unstick(env, NOW), undefined);
  });
});

describe("scheduled", () => {
  it("sends the detour queue with the dispatch", async () => {
    const calls = fakeGithub([{ id: 7, status: "waiting", created_at: new Date(Date.now() - 600 * 60_000).toISOString() }], {
      cancelRefused: [7],
    });
    await worker.scheduled({ cron: "32 10 * * *", scheduledTime: Date.now() }, env);
    const sent = calls.find((call) => call.url.endsWith("/dispatches"));
    assert.deepEqual(JSON.parse(sent?.body ?? "{}"), { ref: "main", inputs: { tarefa: "edicao", fila: "desvio-7" } });
  });

  it("dispatches as before when nothing is stuck", async () => {
    const calls = fakeGithub([]);
    await worker.scheduled({ cron: "32 10 * * *", scheduledTime: Date.now() }, env);
    const sent = calls.find((call) => call.url.endsWith("/dispatches"));
    assert.deepEqual(JSON.parse(sent?.body ?? "{}"), { ref: "main", inputs: { tarefa: "edicao" } });
  });
});
