# AI Model Benchmark Data Sources — Research & Recommendation

Research date: 2026-08-14. All endpoints below were tested with live requests
(`curl` / FetchUrl / WebSearch) on this date. Do not trust these values blindly —
re-verify before shipping, as leaderboards and APIs change frequently.

---

## TL;DR Recommendation

- **Primary: Artificial Analysis Data API (free tier)** — the only single source
  that gives quality indices + coding/reasoning/math + price + speed/latency in one
  clean JSON, with broad model coverage (OpenAI, Anthropic, Google, Meta, DeepSeek,
  Qwen, xAI, z.ai/GLM, Moonshot/Kimi, Mistral, Maritaca, etc.). Requires a **free
  API key** (signup) and attribution. Blockers: **100 requests / 24h**, and
  **context window is Pro-only** (not in free tier).
- **Fallback / complement: LMArena Elo via the community daily-snapshot repo**
  (`oolong-tea-2026/arena-ai-leaderboards`) — no auth, fresh daily, gives Elo +
  votes + vendor per category (text, code, vision, math, agent...). Use for the
  "crowd ELO" axis and as a resilience fallback if the AA key is rate-limited.
- **Supplementary (open-weights only, mostly stale): Hugging Face** datasets-server
  for Open LLM Leaderboard and LiveBench. No auth, but data is frozen (see below).

Cache aggressively (fetch once/day into a local JSON, serve from cache) so the AA
100/day limit is never a concern.

---

## 1. Artificial Analysis (artificialanalysis.ai) — RECOMMENDED PRIMARY

- Base URL: `https://artificialanalysis.ai/api/v2`
- Auth: **required on every endpoint** via `x-api-key` header. Get a free key at
  `https://artificialanalysis.ai/api-key-management-redirect` (login/signup). No
  OAuth, just the one header. Keep it server-side.
- Docs: `https://artificialanalysis.ai/data-api/docs`

### Verified request (no key → 401)
```
curl "https://artificialanalysis.ai/api/v2/data/llms/models"
# HTTP 401  {"error":"API key is required"}
```
Confirms auth is mandatory even for a read. (Note: current v2 path is
`/language/models`, not `/data/llms/models`.)

### Free-tier request (needs a free key)
```
curl "https://artificialanalysis.ai/api/v2/language/models/free" \
  -H "x-api-key: $ARTIFICIAL_ANALYSIS_API_KEY"
```
`/language/models` (non-free, richer) and `/language/models/{slug}` are **Pro-only**
(return 403 on a free key). Free integrations must use `.../models/free`.

### Response shape (from official docs — envelope is consistent)
```jsonc
{
  "tier": "free",
  "intelligence_index_version": 4.1,
  "pagination": { "page": 1, "page_size": 100, "total_pages": 1, "has_more": false },
  "data": [
    {
      "id": "...",
      "name": "GPT-5.x",
      "slug": "gpt-5",
      "release_date": "2025-xx-xx",
      "model_creator": { "name": "OpenAI", "slug": "openai" },
      "evaluations": {
        // composite Artificial Analysis indices (free tier = headline indices only)
        "artificial_analysis_intelligence_index": 00.0,
        "artificial_analysis_coding_index": 00.0,
        "artificial_analysis_agentic_index": 00.0
        // Pro tier adds per-benchmark scores (GPQA, HLE, MATH, SciCode, etc.)
      },
      "artificial_analysis_intelligence_index_cost": { "total_cost": 0.0, "cost_per_task": { "total_cost": 0.0 } },
      "pricing": { /* free tier: input + output token price only */ },
      "performance": { /* free tier: MEDIANS only (output tokens/s, TTFT, e2e) */ }
    }
  ]
}
```

### Metrics available on FREE tier
- Composite indices: **Intelligence Index (overall quality), Coding Index, Agentic
  Index** (index version v4.1.1, composed of 9 evals incl. GPQA Diamond, HLE,
  Terminal-Bench, SciCode, AA-LCR, AA-Omniscience, etc.).
- **Pricing**: input + output $/token (blended pricing is Pro-only).
- **Performance (medians)**: output tokens/sec (throughput), time-to-first-token,
  time-to-first-answer-token, end-to-end response time.
- Model metadata: name, slug, creator, release date.

### NOT on free tier (blockers to note)
- **Context window** (`context_window_tokens`) → Pro only.
- Per-benchmark eval breakdown, blended pricing, percentiles/quartiles, parameters,
  modalities, licensing, provider-level data → Pro / Commercial only.
- Per-provider data & performance-over-time → Commercial only.

### Coverage / freshness / limits / terms
- Coverage: very broad — all major labs incl. Chinese (DeepSeek, Qwen, GLM/z.ai,
  Kimi/Moonshot) and others; Maritaca (Brazil) appears on their site. Hundreds of
  model entries.
- Freshness: actively maintained; homepage updated within days of new releases.
- Rate limit: **Free = 100 req / 24h** (fixed window, shared across org). Pro = 500.
  Headers: `X-RateLimit-Limit/Remaining/Reset`, `Retry-After` on 429.
- License/terms: **Attribution required on all tiers** — visible byline or footer
  link crediting Artificial Analysis. Subject to their Terms of Use. Fine for a
  portfolio dashboard as long as you attribute. Redistribution needs a contract.

---

## 2. LMArena / Chatbot Arena (arena.ai, formerly lmarena.ai) — RECOMMENDED FALLBACK

- **No official public REST API.** The official site renders the leaderboard
  client-side; HF Spaces (`lmarena-ai/chatbot-arena`, `arena-leaderboard`) are just
  iframes. The HF `lmarena-ai/*` datasets are **raw preference votes** (e.g.
  `arena-human-preference-100k`, last modified 2025-02), **not** the computed
  leaderboard.

### Verified working fallback: community daily snapshots (no auth)
Repo: `https://github.com/oolong-tea-2026/arena-ai-leaderboards` — daily JSON
snapshots of every Arena leaderboard, tracked historically. Verified fresh:
snapshots exist through **2026-08-13** (day before research date).

```
curl "https://raw.githubusercontent.com/oolong-tea-2026/arena-ai-leaderboards/main/data/latest.json"
# -> {"date":"2026-08-13","path":"data/2026-08-13"}

curl "https://raw.githubusercontent.com/oolong-tea-2026/arena-ai-leaderboards/main/data/2026-08-13/text.json"
```
Verified response shape:
```jsonc
{
  "meta": {
    "leaderboard": "text",
    "source_url": "https://arena.ai/leaderboard/text",
    "fetched_at": "2026-08-13T03:52:46Z",
    "last_updated": "Aug 12, 2026",
    "model_count": 30
  },
  "models": [
    { "rank": 1, "model": "claude-fable-5", "vendor": "Anthropic",
      "license": "proprietary", "score": 1507.0, "ci": 5.0, "votes": 21439 },
    { "rank": 2, "model": "claude-opus-4-6-high", "vendor": "Anthropic",
      "license": "proprietary", "score": 1505.0, "ci": 4.0, "votes": 72466 }
    // ...
  ]
}
```
- Categories available per day: `text`, `code`, `vision`, `agent`, `document`,
  `search`, `text-to-image`, `image-edit`, `text-to-video`, `image-to-video`,
  `video-edit` (plus `_index.json`). Schemas in `/schemas`.
- Metrics: **Elo score, 95% CI, vote count, vendor, license, rank** per model.
- Coverage: ~30 models per category (top current models across labs).
- Update frequency: **daily** (auto-committed).
- Terms caveat: this is an **unofficial third-party scrape** of arena.ai. Elo data
  itself is LMArena's; for a portfolio project this is low-risk with attribution to
  LMArena, but there is no formal license/guarantee — treat as best-effort and pin
  to the raw file. (Official option would be scraping arena.ai yourself.)

---

## 3. Hugging Face Open LLM Leaderboard — SUPPLEMENTARY (open models, STALE)

- Data is fully accessible with **no auth** via the datasets-server rows API:
```
curl "https://datasets-server.huggingface.co/rows?dataset=open-llm-leaderboard%2Fcontents&config=default&split=train&offset=0&length=100"
```
- Verified: `num_rows = 4576`. Columns include `eval_name`, `Model`, `Type`,
  `Precision`, `Architecture`, `Average ⬆️`, `Hub License`, plus per-benchmark
  columns (IFEval, BBH, MATH-Lvl5, GPQA, MUSR, MMLU-PRO).
- **Blocker: STALE.** Dataset `lastModified = 2025-03-20`; the Open LLM Leaderboard
  was archived in 2025. **Open-weights models only — no OpenAI/Anthropic/Google
  closed models.** Not suitable as a primary "current models" source, but fine for
  historical open-model comparison.
- License: benchmark data is open; check individual model `Hub License`.

---

## 4. Other sources evaluated

- **LiveBench (livebench.ai)** — site returns HTTP 200; questions/answers published
  as HF datasets under `author=livebench` (`livebench/reasoning`, `/coding`,
  `/math`, `/language`, `/data_analysis`, `/instruction_following`). No auth. BUT
  the computed leaderboard is not a clean single JSON, and the HF datasets are the
  eval *questions/model answers*, last modified **2025-04-07** (stale). Good for
  methodology reference, weak for a live-scores feed.
- **Epoch AI Benchmarking Hub** — publishes benchmark data (GPQA, FrontierMath,
  etc.) and offers CSV/data downloads; good for a small set of hard benchmarks but
  narrower model coverage and not a single stable JSON API. Consider only for
  specific frontier-math/reasoning charts.
- **Vellum LLM Leaderboard** — nicely presented but data is rendered/curated on
  their site with no documented public JSON API; would require scraping. Skip.
- **SWE-bench** — leaderboard is coding-agent focused, published as JSON on their
  site/GitHub; useful only for a dedicated coding-agent chart, not general metrics.
- **Official published eval numbers** — authoritative but scattered across model
  cards / blog posts, inconsistent formats; not programmatically uniform. Avoid as
  a primary feed.

---

## Final Recommendation (for the Node backend)

1. **Primary: Artificial Analysis `/api/v2/language/models/free`** with a free
   `x-api-key`. It uniquely covers all requested axes in one call: overall quality
   (Intelligence Index), coding, agentic, price (input/output), and speed
   (throughput, TTFT, e2e) — across a broad, current, multi-region model set.
   Fetch once/day server-side into a cached JSON to stay well under 100 req/24h,
   and render an "Artificial Analysis" attribution footer.
   - Known gap: **context window not in free tier** — source it separately (static
     map of known context windows per model, or upgrade to Pro if needed).
2. **Fallback / second axis: LMArena Elo** via
   `oolong-tea-2026/arena-ai-leaderboards` raw JSON (no auth, daily, per-category
   Elo + votes). Use for the crowd-preference ELO chart and as a resilience
   fallback if the AA key is unavailable or rate-limited.
3. **Optional historical: HF Open LLM Leaderboard** (no auth) for open-weights
   deep-dive charts, clearly labeled as archived/2025 data.

Net blockers: AA needs a free signup key + attribution and caps at 100 req/day
(mitigated by daily caching); AA free tier omits context window; LMArena has no
official API (use the community mirror or self-scrape); Open LLM Leaderboard and
LiveBench HF data are stale and open-models-only.
