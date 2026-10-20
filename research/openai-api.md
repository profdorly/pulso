# OpenAI API Reference for the AI-News Dashboard

Research date: 2026-08-14. All facts below were verified against live OpenAI
documentation on this date. Cited URLs are inline. This supersedes any stale
training knowledge — the current model family is **GPT-5.6** (Sol / Terra / Luna),
not the older GPT-4o / GPT-5 mini/nano lineup.

Primary sources:
- Web search tool: https://developers.openai.com/api/docs/guides/tools-web-search
- Structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Pricing: https://developers.openai.com/api/docs/pricing
- Model catalog: https://developers.openai.com/api/docs/models

> **Update 2026-10-09.** GPT-6 models now in use, verified on the pricing and model pages:
> `gpt-6-luna` $0.10 in / $0.50 out per 1M (cached input $0.01; reasoning effort `none`
> to `max`, default `medium`) for the worker and summaries, and `gpt-6.1-sol` $2.00 / $10.00
> (cached $0.10; effort `low` to `max`, no `none`) for the cover and the humanizer. Measured on
> one humanizer batch of six items: Sol spent 51 reasoning tokens of 2,072 output (Terra 62 of
> 1,978) and took ~33 s against Terra's ~16 s, so the saving is the output price, not fewer tokens.

---

## TL;DR recommendations

- **Use the Responses API** (`client.responses.create` / `.parse`) for both
  capabilities. It is OpenAI's recommended interface and the only one that
  supports the full-featured hosted `web_search` tool (domain filters, source
  lists, live-access control). Chat Completions web search is legacy-only.
- **Recommended model for both tasks: `gpt-5.6-luna`** — cheapest current model
  ($0.20 in / $1.20 out per 1M tokens), supports web search AND structured
  outputs, 1.05M context, knowledge cutoff Feb 16 2026. Step up to
  `gpt-5.6-terra` ($2 / $12) only if Luna's summary/discovery quality proves
  insufficient.
- **Web search is viable and affordable.** The dominant cost is the tool-call
  surcharge: **$10.00 / 1,000 search calls = $0.01 per call** (plus retrieved
  "search content" tokens billed at the model's normal input rate). For a
  dashboard doing a bounded number of discovery queries per refresh, this is
  cheap. Token costs on Luna are negligible by comparison.
- **Structured outputs**: enforce a strict JSON schema via
  `text: { format: { type: "json_schema", strict: true, ... } }` (Responses API).
  In Node use the Zod helper `zodTextFormat(schema, "name")`.

---

## 1. Which API: Responses vs Chat Completions

**Use the Responses API.** From the web-search guide's "Choose an integration"
table:

| Use case | Recommended path |
| --- | --- |
| New web search integration | Responses API with `web_search` and a GPT-5.x model |
| Existing Chat Completions search | Chat Completions with `gpt-5-search-api` (legacy only) |
| Multi-step / long research | GPT-5.x with `high`/`xhigh` reasoning + background mode |

Key differences relevant to us:
- Responses `web_search` is a **tool the model may choose to call** (or you can
  force it with `tool_choice`). Chat Completions search models **always search
  before responding** and do NOT support domain filters, full source lists,
  live-access control, or return-token budget.
- Structured Outputs are supported in both APIs, but the Responses API uses
  `text.format` while Chat Completions uses `response_format`.

Because the dashboard wants controllable web-search discovery + structured JSON,
the Responses API is the correct single home for both features.

---

## 2. AI web-search discovery

### Enabling web search

Add the built-in tool to the `tools` array. For **new** integrations use
`{ type: "web_search" }`. The older `{ type: "web_search_preview" }` still works
but does NOT support `filters`, `external_web_access`, or `return_token_budget` —
do not use it for new code.

Chat Completions equivalent is the dedicated model `gpt-5-search-api` (legacy;
skip it).

### Response shape and extracting citations / source URLs

A response that used web search contains two kinds of output items:

1. A `web_search_call` item — the search action(s) the model ran. Each `search`
   action incurs the tool-call cost. `open_page` / `find_in_page` actions appear
   with reasoning models.
2. A `message` item whose `content[0].text` is the answer and whose
   `content[0].annotations` array holds `url_citation` objects
   (`url`, `title`, `start_index`, `end_index`).

Example `output` array (from the docs):

```json
[
  {
    "type": "web_search_call",
    "id": "ws_...",
    "status": "completed",
    "action": { "type": "search", "query": "latest news about AI" }
  },
  {
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "output_text",
        "text": "On ... several news ...",
        "annotations": [
          {
            "type": "url_citation",
            "start_index": 2606,
            "end_index": 2758,
            "url": "https://...",
            "title": "Title..."
          }
        ]
      }
    ]
  }
]
```

- **Inline citations** = the `annotations` on the message (most relevant refs).
  OpenAI's usage policy requires these be shown clickable in the UI when you
  display web-derived content.
- **Full source list**: add `include: ["web_search_call.action.sources"]` to get
  every URL the model consulted via the `sources` field (usually more than the
  citations). Real-time feeds are labeled `oai-sports` / `oai-weather` /
  `oai-finance`.

### Useful controls (Responses `web_search` only)

- `search_context_size`: `"low"` | `"medium"` | `"high"` — how much retrieved
  content the model sees. Use `low` for cheap quick lookups.
- `filters.allowed_domains` / `filters.blocked_domains`: up to 100 each; omit the
  `https://` prefix; includes subdomains. Great for restricting discovery to
  known AI-company / newsroom domains.
- `user_location` (approximate country/city/region) to bias regional results.
- `tool_choice: "required"` to force a search (default `"auto"` makes it
  optional).
- `external_web_access: false` for cache-only mode (default is live).
- `return_token_budget: "unlimited"` only for heavy reasoning research runs.

### Example (a): web-search discovery returning structured JSON (Node / TS)

You can combine `web_search` with a strict output schema in one call. Force the
search and constrain the output shape:

```ts
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

const openai = new OpenAI(); // reads OPENAI_API_KEY

const NewsItem = z.object({
  title: z.string(),
  source: z.string(),
  url: z.string(),
  date: z.string(),          // ISO date if available, else best-effort
  summary: z.string(),
  company: z.string(),
});
const Discovery = z.object({ items: z.array(NewsItem) });

const response = await openai.responses.parse({
  model: "gpt-5.6-luna",
  tools: [
    {
      type: "web_search",
      search_context_size: "medium",
      // Optionally scope to trusted AI newsrooms / companies:
      // filters: { allowed_domains: ["openai.com", "deepmind.google", "anthropic.com"] },
    },
  ],
  tool_choice: "auto",               // or "required" to guarantee a search
  include: ["web_search_call.action.sources"],
  input: [
    {
      role: "system",
      content:
        "You are an AI-news scout. Search the web for the most recent AI product " +
        "launches and announcements from major AI companies across the US, China, " +
        "Brazil, and worldwide. Return only items from the last 14 days. Every item " +
        "must include a real source URL you actually found via search.",
    },
    { role: "user", content: "Find the latest notable AI launches and news." },
  ],
  text: { format: zodTextFormat(Discovery, "discovery") },
});

const items = response.output_parsed?.items ?? [];

// Cross-check / enrich with the true citation URLs from the search tool:
for (const out of response.output) {
  if (out.type === "message") {
    for (const c of out.content) {
      if (c.type === "output_text") {
        for (const a of c.annotations ?? []) {
          if (a.type === "url_citation") {
            // a.url, a.title  -> authoritative source links to display
          }
        }
      }
    }
  }
}
```

Note: `responses.parse` with `zodTextFormat` gives you `output_parsed` (typed).
The model-authored `url` fields inside the JSON should be treated as
best-effort; prefer/validate against the real `url_citation` annotations and the
`sources` list for link integrity (see hallucination caveats below).

---

## 3. AI summarization / curation with structured outputs

### Enforcing a strict JSON schema

Structured Outputs guarantees schema adherence (unlike plain JSON mode). In the
Responses API:

```
text: { format: { type: "json_schema", name: "...", strict: true, schema: {...} } }
```

In Node the Zod helper builds this for you: `zodTextFormat(ZodSchema, "name")`.
(Chat Completions uses `response_format: { type: "json_schema", json_schema: {...} }`
or the `zodResponseFormat` helper — but stick with Responses.)

Supported starting with GPT-4o; for new projects use GPT-5.6. All three GPT-5.6
models (Sol/Terra/Luna) support it.

### Example (b): structured summarization of article / RSS text (Node / TS)

```ts
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

const openai = new OpenAI();

const Summary = z.object({
  headline: z.string(),
  summary: z.string(),                 // 2-3 sentence digest
  highlights: z.array(z.string()),     // bullet key points
  tags: z.array(z.string()),           // topical tags
  company: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
});

const articleText = "..."; // raw article body or RSS content

const response = await openai.responses.parse({
  model: "gpt-5.6-luna",
  input: [
    {
      role: "system",
      content:
        "You summarize AI-industry articles into concise, factual digests. " +
        "Do not invent facts not present in the provided text.",
    },
    { role: "user", content: articleText },
  ],
  text: { format: zodTextFormat(Summary, "summary") },
});

const result = response.output_parsed; // typed Summary object
```

No web search tool here, so there is **no** $10/1k surcharge — summarization is
pure token cost (extremely cheap on Luna).

### Structured Outputs gotchas & limitations

- Set `strict: true` to actually enforce the schema. Without it you only get
  best-effort JSON.
- Every object needs `additionalProperties: false`, and **all** properties must
  be listed in `required`. To make a field "optional", make it nullable (union
  with `null`) rather than omitting it from `required`. (Zod: `.nullable()`.)
- The JSON Schema subset is limited: many validation keywords
  (e.g. min/max length, formats, patterns on some types) and constructs are
  restricted, and there are caps on total properties and nesting depth. Keep
  schemas flat and simple; validate finer constraints in your own code.
- The **first** request with a new schema incurs extra latency while OpenAI
  processes/caches the schema grammar; subsequent calls are fast.
- Always handle non-happy paths: check `response.status === "incomplete"`
  (`incomplete_details.reason === "max_output_tokens"` or `"content_filter"`),
  and check for a `refusal` content item (safety refusals are programmatically
  detectable). Give enough `max_output_tokens` so JSON isn't truncated.
- Combining web search + structured outputs works, but the model's self-reported
  URLs are still generated text — reconcile them with `url_citation` annotations.

---

## 4. Current models, pricing, and cost-benefit ranking (verified 2026-08-14)

Frontier family — **all support Web search, File search, Functions, structured
outputs**, 1.05M context, 128K max output, reasoning levels
`none|low|medium|high|xhigh|max`, knowledge cutoff Feb 16 2026.
Prices per 1M tokens, Standard tier, short context
(source: pricing page + model catalog):

| Model ID | Alias | Input | Cached in | Output | Web search? | Structured out? |
| --- | --- | --- | --- | --- | --- | --- |
| `gpt-5.6-luna` | — | $0.20 | $0.02 | $1.20 | Yes | Yes |
| `gpt-5.6-terra` | — | $2.00 | $0.20 | $12.00 | Yes | Yes |
| `gpt-5.6-sol` | `gpt-5.6` | $5.00 | $0.50 | $30.00 | Yes | Yes |

Long-context pricing (for inputs beyond the short-context threshold) is roughly
2x the input and higher output — e.g. Luna long-context $0.40 in / $1.80 out.
Batch API halves standard prices (Luna batch: $0.10 in / $0.60 out); Flex same as
batch; Fast mode is ~2x standard.

Other relevant models:
- `gpt-5-search-api` — Chat Completions-only web search model (legacy path). Skip.
- `gpt-4o-search-preview` / `gpt-4o-mini-search-preview` — **deprecated, shut
  down 2026-07-23.** Do not use.
- `daybreak-blue-latest` alias → `gpt-5.6-sol`; `gpt-5.6-cyber` is a pricey
  cybersecurity specialist ($12.50 / $75) — irrelevant here.

### Web-search tool surcharge (this is the real cost driver)

From the pricing "Tools" section:

| Tool | Pricing |
| --- | --- |
| Web search (all models, `web_search`) | **$10.00 / 1k calls** + search content tokens at model rate |
| Image web search | $10.00 / 1k calls + content tokens |
| Web search preview (reasoning models) | $10.00 / 1k calls + content tokens |
| Web search preview (non-reasoning models) | $25.00 / 1k calls, content tokens free |

So each `search` action ≈ **$0.01**. A reasoning model doing agentic search may
issue multiple search actions per request; a non-reasoning quick lookup issues
one. "Search content tokens" (retrieved page text fed to the model) are billed as
normal input tokens at the model's rate — negligible on Luna.

### Cost-benefit ranking

1. **`gpt-5.6-luna` — best value, use this by default** for both discovery and
   summarization. ~10x cheaper input / 10-25x cheaper output than Terra/Sol.
2. **`gpt-5.6-terra` — mid tier**, only if Luna quality is insufficient for
   discovery accuracy or summary nuance.
3. **`gpt-5.6-sol` (`gpt-5.6`) — flagship**, overkill and expensive for this
   workload; reserve for hard reasoning if ever needed.

Cost intuition for the dashboard: a discovery refresh doing, say, 20 web-search
calls costs ~$0.20 in tool fees regardless of model; on Luna the token cost on
top is a rounding error. Summarizing dozens of articles/day on Luna costs cents.

---

## 5. Rate limits and tier considerations

- Web search consumes the **underlying model's tiered rate limits** — there is no
  separate web-search rate limit. Higher usage tiers (spend history) raise your
  RPM/TPM ceilings.
- The web-search **search context window is capped at 128K** even though the
  model context window is 1.05M.
- For long-running multi-search research, use `background: true` (background mode)
  so requests can run asynchronously; not needed for the dashboard's bounded
  discovery/summarization calls.
- Service tiers affect price/latency, not correctness: `service_tier: "fast"`
  (formerly `"priority"`) ~2x cost for lower latency; Flex/Batch are cheaper for
  non-urgent bulk work. Batch is ideal for bulk summarization of an RSS backlog.

---

## 6. Caveats: web-search freshness, quality, hallucination

- **Freshness**: `web_search` defaults to live internet access
  (`external_web_access: true`). "Non-reasoning web search" just relays top
  results (fast, shallow); "agentic search" with a reasoning effort explores more
  but is slower/pricier. For recency, prompt explicitly for a date window and
  consider `tool_choice: "required"` so a search actually happens — with `"auto"`
  the model may answer from parametric memory (knowledge cutoff Feb 16 2026) and
  skip searching.
- **Result quality**: `search_context_size` and domain `filters` materially
  affect quality. Restricting `allowed_domains` to reputable AI newsrooms /
  company blogs reduces junk. `search_context_size: "low"` may miss detail; use
  `"medium"` for discovery.
- **Hallucination / link integrity**: text the model writes (including URLs it
  places inside your JSON) can be fabricated or mis-attributed. Trust the
  structured `url_citation` annotations and the `sources` list (real URLs the
  tool retrieved) over model-authored URL strings. Validate/deduplicate URLs and
  optionally re-fetch to confirm before display. Also enforce your date-window
  requirement in code — the model may include older items.
- **UI requirement**: when displaying web-sourced content, OpenAI requires inline
  citations to be visible and clickable.
- **Reasoning effort trade-off**: `gpt-5.4` with effort `none` is noted to give
  lower-quality search results; GPT-5 with `minimal` reasoning does not support
  web search at all. On GPT-5.6 models, a low-to-medium reasoning effort is a
  good balance for discovery.

---

## Suggested architecture for the dashboard

- **Discovery job** (scheduled): one or a few Responses API calls with
  `model: "gpt-5.6-luna"`, `tools: [{ type: "web_search", search_context_size:
  "medium", filters: {...} }]`, `tool_choice: "required"`,
  `include: ["web_search_call.action.sources"]`, and a strict `text.format`
  schema of news items. Reconcile item URLs with `url_citation` annotations.
- **Summarization/curation job**: per-article Responses API calls with
  `model: "gpt-5.6-luna"` and a strict summary schema, no tools. Use the Batch
  API for large backfills to halve cost.
- Keep model IDs in config so you can bump Luna → Terra per-task if quality
  demands it without code changes.
