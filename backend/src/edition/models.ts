/**
 * Default OpenAI models per role. The kitchen Lambda sets the same names through
 * `OPENAI_MODEL_*` in infra/staging/template.yaml, which win over these; change both together.
 *
 * Editorial (cover and humanizer) moved from GPT-5.6 Terra to GPT-6.1 Sol and the worker
 * (classification, titles, blurbs, summaries) from GPT-5.6 Luna to GPT-6 Luna: same or newer
 * generation, lower price per output token ($10 vs $12 and $0.50 vs $1.20 per 1M). Discovery
 * stays on Terra until its own review.
 */
export const PULSO_DISCOVERY_MODEL = "gpt-5.6-terra";
export const PULSO_EDITORIAL_MODEL = "gpt-6.1-sol";
export const PULSO_WORKER_MODEL = "gpt-6-luna";
/**
 * Web search beyond the feeds. Luna with medium reasoning, one call per region: in the October
 * 2026 test it found as much per dollar as GPT-6.1 Sol and more than Luna at low reasoning, which
 * stopped after two searches. Search content tokens bill at the model's input rate, so the cheap
 * model leaves the $0.01 per search as almost the whole cost.
 */
export const PULSO_SEARCH_MODEL = "gpt-6-luna";

export function pulsoModelNames(env: {
  OPENAI_MODEL?: string;
  OPENAI_MODEL_DISCOVERY?: string;
  OPENAI_MODEL_EDITORIAL?: string;
  OPENAI_MODEL_WORKER?: string;
} = {}): { discovery: string; editorial: string; worker: string } {
  return {
    discovery: env.OPENAI_MODEL_DISCOVERY ?? PULSO_DISCOVERY_MODEL,
    editorial: env.OPENAI_MODEL_EDITORIAL ?? PULSO_EDITORIAL_MODEL,
    worker: env.OPENAI_MODEL_WORKER ?? env.OPENAI_MODEL ?? PULSO_WORKER_MODEL,
  };
}
