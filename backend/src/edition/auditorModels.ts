import OpenAI from "openai";
import type { AuditorModel } from "./auditor.js";

/**
 * Provider adapters for the auditor.
 *
 * The auditor should not judge its own writing: a judge favours its own output, and the effect
 * grows with capability. For a year that meant a different family — writers on OpenAI, the
 * judge on Bedrock Claude — and provider portability is why the contract is a system string in,
 * text out: any OpenAI-compatible endpoint can serve as the judge through `baseURL`.
 *
 * Bedrock access ended in October 2026, so the default judge is now OpenAI's GPT-6.1 Sol. That
 * is the same company as the writers, a trade-off accepted and measured rather than ignored
 * (research/auditor-eval.md): the item copy it audits is written by a different model, GPT-6 Luna,
 * and an edition still reports self-review when the judge is the very model that wrote or
 * revised the copy.
 */

/** Reasoning efforts the OpenAI SDK accepts; GPT-6.1 Sol supports `low` and up. */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface OpenAiCompatibleOptions {
  apiKey: string;
  model: string;
  /** Omit for OpenAI; set to the provider's base for anything else. */
  baseURL?: string;
  client?: OpenAI;
  /**
   * Only sent when set.
   *
   * Pinning it to 0 would make an audit reproducible, which is what an audit should be, but
   * several current models reject any value other than the default and fail the whole call.
   * A verdict that arrives is worth more than a verdict that would have been deterministic.
   */
  temperature?: number;
  /** Only sent when set; reasoning models spend these tokens before the visible answer. */
  reasoningEffort?: ReasoningEffort;
  /** Output cap, reasoning included. Only sent when set. */
  maxCompletionTokens?: number;
  /**
   * Enforce the requested `format` through Structured Outputs. Off by default because the
   * adapter also serves OpenAI-compatible providers that may not implement `json_schema`.
   */
  structuredOutputs?: boolean;
}

/**
 * Retries and a per-request timeout matter for the same reason as on Bedrock: the audit pass
 * removes any text whose verdict does not arrive, so a transient 429 or a hung request would
 * silently strip copy from the edition. The SDK retries 408/409/429/5xx and dropped connections.
 */
const OPENAI_AUDIT_MAX_RETRIES = 4;
const OPENAI_AUDIT_TIMEOUT_MS = 90_000;

export function openAiCompatibleAuditor(options: OpenAiCompatibleOptions): AuditorModel {
  const client =
    options.client ??
    new OpenAI({
      apiKey: options.apiKey,
      maxRetries: OPENAI_AUDIT_MAX_RETRIES,
      timeout: OPENAI_AUDIT_TIMEOUT_MS,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });

  return {
    id: options.model,
    async complete({ system, user, format }) {
      const response = await client.chat.completions.create({
        model: options.model,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
        ...(options.maxCompletionTokens ? { max_completion_tokens: options.maxCompletionTokens } : {}),
        ...(format && options.structuredOutputs
          ? {
              response_format: {
                type: "json_schema" as const,
                json_schema: { name: format.name, schema: format.schema, strict: true },
              },
            }
          : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const text = response.choices[0]?.message?.content ?? "";
      const usage = response.usage
        ? {
            inputTokens: response.usage.prompt_tokens ?? 0,
            outputTokens: response.usage.completion_tokens ?? 0,
          }
        : undefined;
      return { text, ...(usage ? { usage } : {}) };
    },
  };
}

/**
 * Default OpenAI auditor, chosen by measurement (research/auditor-eval.md). It matched Opus 4.6
 * on the seeded corpus, 21 of 21, and on a real fifty-item edition it returned a readable verdict
 * every time, kept five texts Opus had removed and caught a plan reported as done that Opus let
 * through, at about a third of the cost.
 */
export const DEFAULT_OPENAI_AUDITOR_MODEL = "gpt-6.1-sol";

/** `medium` scored the same on the corpus and took 2.5 times as long. */
export const DEFAULT_OPENAI_AUDITOR_EFFORT: ReasoningEffort = "low";

/**
 * Output cap for one edition verdict, reasoning included. A verdict is under 200 tokens; the rest
 * is room for reasoning, and the cap bounds what a runaway answer can cost.
 */
export const OPENAI_AUDIT_MAX_COMPLETION_TOKENS = 4000;

/** A known effort from an env string, case-insensitive; anything else is undefined. */
export function reasoningEffortFrom(value: string | undefined): ReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase();
  return REASONING_EFFORTS.find((effort) => effort === normalized);
}

export interface AuditorFromEnvOptions {
  OPENAI_API_KEY?: string;
  PULSO_AUDITOR_PROVIDER?: string;
  PULSO_AUDITOR_MODEL?: string;
  /** OpenAI only: overrides DEFAULT_OPENAI_AUDITOR_EFFORT; unknown values are ignored. */
  PULSO_AUDITOR_REASONING_EFFORT?: string;
}

export interface AuditorBuildOptions {
  /**
   * Output cap for one answer. The edition's defaults fit a one-item verdict; a caller auditing
   * something bigger, like the weekly script, needs more.
   */
  maxOutputTokens?: number;
}

/**
 * Builds the auditor from environment, or explains what is missing.
 *
 * Returns a reason instead of throwing so the caller can record "not configured" as a result —
 * an unconfigured auditor must never look like a passing one.
 */
export function auditorFromEnv(
  env: AuditorFromEnvOptions,
  options: AuditorBuildOptions = {}
): { model: AuditorModel; provider: string } | { reason: string } {
  const provider = (env.PULSO_AUDITOR_PROVIDER ?? "openai").toLowerCase();

  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) return { reason: "OPENAI_API_KEY ausente" };
    return {
      provider: "openai",
      model: openAiCompatibleAuditor({
        apiKey: env.OPENAI_API_KEY,
        model: env.PULSO_AUDITOR_MODEL ?? DEFAULT_OPENAI_AUDITOR_MODEL,
        reasoningEffort:
          reasoningEffortFrom(env.PULSO_AUDITOR_REASONING_EFFORT) ?? DEFAULT_OPENAI_AUDITOR_EFFORT,
        maxCompletionTokens: options.maxOutputTokens ?? OPENAI_AUDIT_MAX_COMPLETION_TOKENS,
        structuredOutputs: true,
      }),
    };
  }

  return { reason: `provedor de auditor desconhecido: ${provider}` };
}
