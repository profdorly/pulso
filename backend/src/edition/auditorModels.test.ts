import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { AUDIT_VERDICT_FORMAT, auditSummary } from "./auditor.js";
import {
  auditorFromEnv,
  DEFAULT_OPENAI_AUDITOR_MODEL,
  openAiCompatibleAuditor,
  reasoningEffortFrom,
} from "./auditorModels.js";

function fakeClient(content: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1200, completion_tokens: 40 },
  });
  return { create, client: { chat: { completions: { create } } } as unknown as OpenAI };
}

describe("openAiCompatibleAuditor", () => {
  it("enforces the verdict schema and sends the reasoning settings when configured", async () => {
    const { create, client } = fakeClient('{"supported": true, "findings": []}');
    const model = openAiCompatibleAuditor({
      apiKey: "sk-test",
      model: "gpt-6.1-sol",
      client,
      reasoningEffort: "low",
      maxCompletionTokens: 4000,
      structuredOutputs: true,
    });

    const result = await auditSummary(
      { body: "Texto da matéria.", feed: "Resumo do feed.", summary: "TITULO: Texto", title: "Title" },
      model
    );

    expect(result.verdict).toEqual({ supported: true, findings: [] });
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 40 });
    const request = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request.model).toBe("gpt-6.1-sol");
    expect(request.reasoning_effort).toBe("low");
    expect(request.max_completion_tokens).toBe(4000);
    expect(request.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: AUDIT_VERDICT_FORMAT.name, schema: AUDIT_VERDICT_FORMAT.schema, strict: true },
    });
    expect(request).not.toHaveProperty("temperature");
    const user = (request.messages as { role: string; content: string }[])[1]?.content ?? "";
    expect(user).toContain("RESUMO_DO_FEED: Resumo do feed.");
    expect(user).toContain("TEXTO:\nTexto da matéria.");
  });

  it("sends no schema or reasoning field unless asked, for OpenAI-compatible providers", async () => {
    const { create, client } = fakeClient('{"supported": false, "findings": []}');
    const model = openAiCompatibleAuditor({ apiKey: "k", model: "other-model", client });

    await auditSummary({ body: "Corpo.", summary: "Texto." }, model);

    const request = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request).not.toHaveProperty("response_format");
    expect(request).not.toHaveProperty("reasoning_effort");
    expect(request).not.toHaveProperty("max_completion_tokens");
  });

  it("tells the auditor when the page did not open and the feed is all the evidence", async () => {
    const { create, client } = fakeClient('{"supported": true, "findings": []}');
    const model = openAiCompatibleAuditor({ apiKey: "k", model: "gpt-6.1-sol", client });

    await auditSummary({ body: "", summary: "TITULO: Texto", title: "Title" }, model);

    const user = (create.mock.calls[0]?.[0] as { messages: { content: string }[] }).messages[1]?.content;
    expect(user).toContain("A página da matéria não abriu");
    expect(user).toContain("(o feed não trouxe resumo; só o título)");
  });
});

describe("auditorFromEnv", () => {
  it("defaults to OpenAI with GPT-6.1 Sol", () => {
    const configured = auditorFromEnv({ OPENAI_API_KEY: "sk-test" });
    expect("model" in configured && configured.provider).toBe("openai");
    expect("model" in configured && configured.model.id).toBe(DEFAULT_OPENAI_AUDITOR_MODEL);
    expect(DEFAULT_OPENAI_AUDITOR_MODEL).toBe("gpt-6.1-sol");
  });

  it("reports a missing key instead of building an auditor that cannot answer", () => {
    expect(auditorFromEnv({ PULSO_AUDITOR_PROVIDER: "openai" })).toEqual({
      reason: "OPENAI_API_KEY ausente",
    });
  });

  it("rejects an unknown provider", () => {
    expect(auditorFromEnv({ PULSO_AUDITOR_PROVIDER: "kimi" })).toEqual({
      reason: "provedor de auditor desconhecido: kimi",
    });
  });
});

describe("reasoningEffortFrom", () => {
  it("accepts known efforts in any case and ignores the rest", () => {
    expect(reasoningEffortFrom("LOW")).toBe("low");
    expect(reasoningEffortFrom(" medium ")).toBe("medium");
    expect(reasoningEffortFrom("turbo")).toBeUndefined();
    expect(reasoningEffortFrom(undefined)).toBeUndefined();
  });
});
