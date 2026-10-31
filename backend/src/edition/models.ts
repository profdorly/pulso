/**
 * Default OpenAI models per role. `OPENAI_MODEL_*` in the environment wins over these.
 *
 * Editorial (cover and humanizer) moved from GPT-5.6 Terra to GPT-6.1 Sol and the worker
 * (classification, titles, blurbs, summaries) from GPT-5.6 Luna to GPT-6 Luna: same or newer
 * generation, lower price per output token ($10 vs $12 and $0.50 vs $1.20 per 1M).
 *
 * Editions published before 31 Oct 2026 also carry `models.discovery` (GPT-5.6 Terra). No step
 * ever called a model under that name; it was a label, and it is no longer written.
 */
export const PULSO_EDITORIAL_MODEL = "gpt-6.1-sol";
export const PULSO_WORKER_MODEL = "gpt-6-luna";
/**
 * Web search beyond the feeds, at medium reasoning. In the 31 Oct 2026 test (three 24-hour
 * windows, same feeds and checks, 12 region-by-topic calls) GPT-6.1 Terra brought 37 stories
 * that passed every check, against 18 for GPT-6 Luna and 23 for GPT-6.1 Sol, at about the same
 * cost per usable story as Luna (~US$ 0.90 a run). Sol cost more and repeated a published story.
 */
export const PULSO_SEARCH_MODEL = "gpt-6.1-terra";

export function pulsoModelNames(env: {
  OPENAI_MODEL?: string;
  OPENAI_MODEL_EDITORIAL?: string;
  OPENAI_MODEL_WORKER?: string;
} = {}): { editorial: string; worker: string } {
  return {
    editorial: env.OPENAI_MODEL_EDITORIAL ?? PULSO_EDITORIAL_MODEL,
    worker: env.OPENAI_MODEL_WORKER ?? env.OPENAI_MODEL ?? PULSO_WORKER_MODEL,
  };
}
