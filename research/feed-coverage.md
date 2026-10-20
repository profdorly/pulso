# Cobertura de feeds: o que é RSS e o que exige descoberta

Medido em 15/08/2026 com `node scripts/probe-feeds.mjs` e `node scripts/probe-feed-discovery.mjs`.
A segunda passada não adivinha caminhos: lê a página e procura o
`<link rel="alternate" type="application/rss+xml">` que o próprio site declara — o que elimina
falso negativo por chute de URL errada.

**22 de 44 candidatos têm feed utilizável.** A conclusão inverte a intuição: são os **labs** que
não publicam feed, e a **imprensa** que publica.

## Labs sem feed algum — descoberta por busca é obrigatória

Confirmado duas vezes: caminhos comuns dão 404/403, e a página não declara feed nenhum.

| lab | página | feed declarado |
| --- | --- | --- |
| Anthropic | HTTP 200 | nenhum |
| xAI | HTTP 403 (bloqueia bot) | nenhum |
| DeepSeek | HTTP 200 | nenhum |
| Moonshot / Kimi | HTTP 200 | nenhum |
| z.ai / Zhipu | HTTP 404 | nenhum |
| Maritaca | HTTP 200 | nenhum |
| Cohere | HTTP 200 | nenhum |

Consequência: a chamada de busca web não é conveniência, é o **único** caminho para ver esses
labs. Não há economia a fazer aqui sem perder cobertura.

## Labs com feed

| id | feed | itens | item mais recente |
| --- | --- | --- | --- |
| openai-news | `openai.com/news/rss.xml` | 1129 | 2026-08-13 |
| google-deepmind | `deepmind.google/blog/rss.xml` | 100 | 2026-08-13 |
| google-ai-blog | `blog.google/technology/ai/rss/` | 20 | 2026-08-13 |
| google-gemini | `blog.google/products/gemini/rss/` | 20 | 2026-08-13 |
| **mistral** | `mistral.ai/rss.xml` | 80 | 2026-08-11 |
| nvidia | `blogs.nvidia.com/feed/` | 18 | 2026-08-14 |
| microsoft-research | `microsoft.com/en-us/research/feed/` | 10 | 2026-08-12 |

Notas:

- **Mistral tem feed e não estava no catálogo.** É o primeiro lab europeu disponível de graça.
  Só `mistral.ai/rss.xml` funciona; `/news/rss.xml` e `/feed.xml` dão 404.
- **Qwen tem feed, mas está morto**: `qwenlm.github.io/blog/index.xml` responde com 44 itens e o
  mais recente é de **2025-09-22**, quase um ano atrás. Inútil como fonte de novidade — Qwen
  continua dependendo de descoberta.
- Os dois feeds de `blog.google` respondem normalmente daqui (20 itens cada, atualizados), o que
  reforça que a falha `value.replace is not a function` vista em staging é de forma de item
  específico ou de ambiente, não de indisponibilidade.

## Imprensa — quase toda com feed, incluindo Europa e Ásia

| id | grupo | feed | itens | mais recente |
| --- | --- | --- | --- | --- |
| wired-ai | us | `wired.com/feed/tag/ai/latest/rss` | 10 | 2026-08-15 |
| rest-of-world | us | `restofworld.org/feed/latest/` | 12 | 2026-08-14 |
| ieee-spectrum-ai | us | `spectrum.ieee.org/feeds/topic/artificial-intelligence.rss` | 30 | — |
| nature-ml | us | `nature.com/subjects/machine-learning.rss` | 30 | — |
| guardian-tech | europe | `theguardian.com/technology/rss` | 29 | 2026-08-15 |
| the-register | europe | `theregister.com/headlines.atom` | 50 | 2026-08-15 |
| heise | europe | `heise.de/rss/heise-atom.xml` | 150 | 2026-08-15 |
| sifted | europe | `sifted.eu/feed` | 24 | 2026-08-14 |
| lemonde-pixels | europe | `lemonde.fr/pixels/rss_full.xml` | 20 | 2026-08-15 |
| ft-tech | europe | `ft.com/technology?format=rss` | 25 | 2026-08-15 |
| nikkei-asia | asia | `asia.nikkei.com/rss/feed/nar` | 50 | — |
| japan-times | asia | `japantimes.co.jp/feed/` | 30 | 2026-08-15 |
| korea-herald | asia | `koreaherald.com/rss/newsAll` | 50 | 2026-08-15 |
| scmp-tech | asia | `scmp.com/rss/36/feed` | 50 | 2026-08-15 |
| scmp-alt | asia | `scmp.com/rss/318208/feed` | 50 | — |

Equilíbrio geográfico entre Brasil, EUA, Europa e Ásia é portanto **resolvível com RSS gratuito**.
Não exige nenhuma chamada de modelo a mais.

## Reuters: sem feed aberto

Citada diretamente como fonte desejada, mas indisponível para leitura automatizada:

- `reuters.com/technology/` → **HTTP 401**
- `reuters.com/rssFeed/technologyNews` → **HTTP 401**
- `feeds.reuters.com/reuters/technologyNews` → falha de conexão
- `reuters.com/arc/outboundfeeds/rss/category/technology/` → **HTTP 404** (caminho descontinuado)
- a página não declara nenhum feed

AP News também: `apnews.com/hub/technology.rss` → 404.

Isso tem consequência direta na regra de fonte original: dá para **linkar** a Reuters como origem
de uma matéria encontrada em outro veículo, mas **não dá para ler o texto da Reuters** — e portanto
não dá para verificar fidelidade de tradução contra ele. Fidelidade só é verificável contra o texto
que foi efetivamente baixado.
