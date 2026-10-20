# AI-News Dashboard — RSS/Atom Feed Verification

Verified: 2026-08-14. Every URL below was fetched with `curl` and confirmed to
return valid RSS/Atom XML (or confirmed NOT to). Freshness was checked against
the most recent item date at time of testing.

Legend:
- Category: `official-company` = first-party company blog/newsroom;
  `impartial-media` = independent news outlet.
- Content: `full` = feed carries full article body (`content:encoded`);
  `summary` = title + excerpt/description only.

---

## WORKING FEEDS

### Official company blogs

| # | Source | Region | Feed URL | Format | Content | Recent item (verified) |
|---|--------|--------|----------|--------|---------|------------------------|
| 1 | OpenAI News | US | `https://openai.com/news/rss.xml` | RSS 2.0 | summary | "The builder's guide to GPT-5.6" — Thu, 13 Aug 2026 |
| 2 | Google DeepMind | US/UK | `https://deepmind.google/blog/rss.xml` | RSS 2.0 | summary | "Introducing Gemini 3.7 Flash" — Thu, 13 Aug 2026 |
| 3 | Google — AI blog | US | `https://blog.google/technology/ai/rss/` | RSS 2.0 | full | "Bring your spreadsheet data to life with Sheets canvas" — Thu, 13 Aug 2026 |
| 4 | Google — Gemini | US | `https://blog.google/products/gemini/rss/` | RSS 2.0 | full | (Gemini product posts) — Thu, 13 Aug 2026 |
| 5 | Google Research | US | `https://research.google/blog/rss/` | RSS 2.0 | summary | "Empty shelves or lost keys? Recall is the bottleneck..." — Wed, 12 Aug 2026 |
| 6 | Microsoft Azure Blog | US | `https://azure.microsoft.com/en-us/blog/feed/` | RSS 2.0 | full | (Azure/Azure AI posts, current) |
| 7 | Meta Newsroom | US | `https://about.fb.com/feed/` | RSS 2.0 | full | (Meta company news) — Thu, 13 Aug 2026 |
| 8 | Hugging Face Blog | US/global | `https://huggingface.co/blog/feed.xml` | RSS 2.0 | summary | "State of Open Models: Summer 2026 Observations" — Fri, 14 Aug 2026 |

Notes:
- #6 Azure is the working substitute for Microsoft's dedicated AI blog
  (`microsoft.com/en-us/ai/blog/feed/` returns a noindex HTML stub — no feed).
  Azure Blog carries Azure AI / Foundry announcements.
- #7 Meta Newsroom is the working substitute for `ai.meta.com/blog`
  (that path serves a Facebook HTML app, no feed). Newsroom is broader than AI
  but includes Meta AI / Llama launches; filter by keyword downstream.
- #8 Hugging Face was not explicitly requested but is a strong, high-freshness
  official-adjacent source for open-model releases (many Chinese labs post
  there); included as a bonus.

### Impartial / news outlets — English

| # | Source | Region | Feed URL | Format | Content | Recent item (verified) |
|---|--------|--------|----------|--------|---------|------------------------|
| 9  | The Verge — AI | US | `https://www.theverge.com/rss/ai-artificial-intelligence/index.xml` | Atom | summary | updated Fri, 14 Aug 2026 16:39 UTC |
| 10 | Ars Technica — AI | US | `https://arstechnica.com/ai/feed/` | RSS 2.0 | full | "OpenAI and Anthropic in price war as Chinese AI rivals gain ground" — Fri, 14 Aug 2026 |
| 11 | MIT Technology Review — AI | US | `https://www.technologyreview.com/topic/artificial-intelligence/feed/` | RSS 2.0 | summary | (AI topic feed, current) |
| 12 | TechCrunch — AI | US | `https://techcrunch.com/category/artificial-intelligence/feed/` | RSS 2.0 | full | (AI category feed, current) |

### Impartial media — China (English editions)

| # | Source | Region | Feed URL | Format | Content | Recent item (verified) |
|---|--------|--------|----------|--------|---------|------------------------|
| 13 | Pandaily | China | `https://pandaily.com/feed` | RSS 2.0 | full | "GLM-5.3 Arrives Hours After Tang Jie's 'sooooooon'..." — Fri, 14 Aug 2026 |
| 14 | Sixth Tone | China | `https://www.sixthtone.com/rss` | RSS 2.0 | summary | "A Chef Caught in a Middle East War Is China's Latest Hit" — Aug 14, 2026 |
| 15 | South China Morning Post — Tech | HK/China | `https://www.scmp.com/rss/36/feed` | RSS 2.0 | summary | "Launch of DeepSeek's Harness marks its strategic pivot towards autonomous agentic AI" — Fri, 14 Aug 2026 |
| 16 | TechNode | China | `https://technode.com/feed/` | RSS 2.0 | full | (China tech, current) |

Note: SCMP `rss/36` = the Tech section; it carries frequent China-AI stories
(DeepSeek, Zhipu/GLM seen in latest items). Best single impartial source for
Chinese AI-lab news in English.

### Impartial media — Brazil (Portuguese)

| # | Source | Region | Feed URL | Format | Content | Recent item (verified) |
|---|--------|--------|----------|--------|---------|------------------------|
| 17 | MIT Technology Review Brasil | Brazil | `https://mittechreview.com.br/feed/` | RSS 2.0 | full | "Como ideias sobre uma vasta rede de censura..." — Fri, 14 Aug 2026 |
| 18 | Tecnoblog | Brazil | `https://tecnoblog.net/feed/` | RSS 2.0 | full | (BR tech, current) |
| 19 | Olhar Digital | Brazil | `https://olhardigital.com.br/feed/` | RSS 2.0 | full | (BR tech, current) |
| 20 | Canaltech | Brazil | `https://canaltech.com.br/rss/` | RSS 2.0 | summary | (BR tech, real-time newsroom feed) |
| 21 | Mobile Time | Brazil | `https://www.mobiletime.com.br/feed/` | RSS 2.0 | full | (BR mobile/tech, current) |

Note: There is no Brazilian *AI-lab* first-party feed among these — they are
general BR tech outlets that cover AI heavily. MIT Tech Review Brasil is the
closest to an AI-focused editorial source. Filter by AI keywords downstream.

### Partial / official release feeds (work, but limited)

| Source | Feed URL | Format | Status |
|--------|----------|--------|--------|
| DeepSeek (GitHub releases) | `https://github.com/deepseek-ai/DeepSeek-V3/releases.atom` | Atom | Valid XML but STALE (last release 2025-06-16). Only fires on model repo releases. |
| Moonshot/Kimi (GitHub releases) | `https://github.com/MoonshotAI/Kimi-K2/releases.atom` | Atom | Valid XML but currently EMPTY (no releases published). |

These are the only machine-readable official signals found for DeepSeek and
Moonshot; treat as low-frequency supplements, not primary feeds.

---

## NO FEED / NEEDS ALTERNATIVE

| Source | What was tested | Result | Suggested alternative |
|--------|-----------------|--------|-----------------------|
| **Anthropic** | `/rss.xml`, `/news/rss.xml`, `/rss`, `/blog/rss.xml` | All return a Next.js `__next_error__` HTML page (noindex) — no official feed exists | Community mirror `https://raw.githubusercontent.com/taobojlen/anthropic-rss-feed/main/anthropic_news_rss.xml` (valid RSS but STALE — last item 2026-06-30). RSSHub `rsshub.app/anthropic/news` is Cloudflare-blocked on the public instance. Best: self-host RSSHub, or scrape `anthropic.com/news`, or AI web-search discovery. |
| **DeepSeek** (official blog) | `deepseek.com/rss.xml`, `api.deepseek.com/rss`, `api-docs.deepseek.com/rss/update.xml` | Next.js app HTML / "Authentication Fails" / Docusaurus HTML — no feed | Scrape `deepseek.com/news`, use SCMP/Pandaily/TechNode for coverage, or GitHub releases feed (stale). AI web-search discovery recommended. |
| **Alibaba Qwen** | `qwenlm.github.io/index.xml`, `qwen.ai/rss`, `qwen.ai/blog/rss` | 404 (old Hugo blog decommissioned; redirects to `qwen.ai/research`) / SPA HTML — no feed | Hugging Face `zai`-style org pages / `huggingface.co/Qwen` activity; scrape `qwen.ai/research`; AI web-search discovery. |
| **Moonshot AI (Kimi)** | `moonshot.cn/rss` | Default nginx welcome page — no feed | GitHub releases feed (empty currently); scrape platform blog; AI web-search discovery. |
| **xAI / Grok** | `x.ai/rss.xml`, `x.ai/blog/rss`, `x.ai/news/rss.xml`, `x.ai/api/rss` | Cloudflare "Attention Required" challenge / Next.js SPA — no feed and bot-blocked | Follow @xai / @grok on X, or scrape `x.ai/news` via a headless/Cloudflare-solving fetch; AI web-search discovery. |
| **z.ai / Zhipu AI / GLM** | `z.ai/blog/rss` | nginx 404 — no feed (blog is a SPA at `z.ai/blog/...`) | Hugging Face `huggingface.co/zai-org` (model/paper drops), Pandaily & SCMP cover GLM launches well; scrape `z.ai/blog`; AI web-search discovery. |
| **Maritaca AI** (Brazil) | `maritaca.ai/rss.xml`, `maritaca.ai/feed`, `blog.maritaca.ai/rss.xml` | Vercel `NOT_FOUND` / empty — no feed | Scrape `maritaca.ai` blog, monitor their Hugging Face org, or AI web-search discovery. No Brazilian AI-lab has a working first-party feed. |
| **Meta AI blog** (`ai.meta.com/blog`) | `/rss/`, `/feed/` | Facebook HTML app — no feed at the AI subpath | Use **Meta Newsroom** feed (#7 above) and keyword-filter for AI/Llama. |
| **Microsoft AI blog** (`microsoft.com/.../ai/blog`) | `/feed/` | noindex HTML stub — no feed | Use **Azure Blog** feed (#6 above). |
| **Caixin Global** | `caixinglobal.com/rss/all.xml` | 404 HTML — no feed | Paywalled; use SCMP / Sixth Tone / TechNode for China coverage; AI web-search discovery. |
| **36Kr English** | `en.36kr.com/feed` | Empty response — no working feed | Use Pandaily / TechNode; scrape `en.36kr.com`; AI web-search discovery. |
| **Tecmundo** (Brazil) | `tecmundo.com.br/rss` | Next.js SPA HTML — path no longer serves a feed | Other BR feeds (#17-21) cover the same ground; recheck a category-specific Tecmundo path if needed. |

---

## COUNT SUMMARY

**Working feeds: 21** (plus 2 low-value GitHub release feeds).

By category:
- official-company: **8** (OpenAI, Google DeepMind, Google AI, Google Gemini, Google Research, Microsoft Azure, Meta Newsroom, Hugging Face)
- impartial-media: **13** (The Verge, Ars Technica, MIT Tech Review, TechCrunch, Pandaily, Sixth Tone, SCMP Tech, TechNode, MIT Tech Review Brasil, Tecnoblog, Olhar Digital, Canaltech, Mobile Time)

By region:
- US / global: **12**
- China / Hong Kong: **4** (Pandaily, Sixth Tone, SCMP, TechNode)
- Brazil: **5** (MIT TR Brasil, Tecnoblog, Olhar Digital, Canaltech, Mobile Time)

**Requested sources with NO working feed** (need alternative / web-search discovery):
Anthropic, DeepSeek, Alibaba Qwen, Moonshot AI (Kimi), xAI/Grok, z.ai/Zhipu/GLM,
Maritaca AI, Meta AI blog (use Meta Newsroom), Microsoft AI blog (use Azure),
Caixin Global, 36Kr English, Tecmundo.
