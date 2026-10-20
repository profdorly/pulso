# Artificial Analysis free tier — cobertura real por modalidade

Medido em 2026-08-15T01:56:47.109Z com uma requisição GET por endpoint no tier gratuito.
Este arquivo é gerado por `node scripts/spike-aa-coverage.mjs`. A pergunta que ele responde:
os dados que chegam sustentam um guia de decisão por modalidade, ou só um ranking?

## language (texto/multimodal)

- endpoint: `/language/models/free`
- status: 200 (tier `free`)
- intelligence_index_version: 4.1
- modelos retornados: 200
- amostra: GLM-4.5V (Non-reasoning), Gemini 3.5 Flash (high), MiMo-V2.5-Pro, JT-35B-Flash, Mercury 2

| campo | preenchido em |
| --- | --- |
| `id` | 100% (200/200) |
| `model_creator.id` | 100% (200/200) |
| `model_creator.name` | 100% (200/200) |
| `name` | 100% (200/200) |
| `release_date` | 100% (200/200) |
| `slug` | 100% (200/200) |
| `evaluations.artificial_analysis_intelligence_index` | 99% (197/200) |
| `pricing.price_1m_input_tokens` | 68% (136/200) |
| `pricing.price_1m_output_tokens` | 68% (136/200) |
| `performance.median_end_to_end_response_time_seconds` | 53% (105/200) |
| `performance.median_output_tokens_per_second` | 53% (105/200) |
| `performance.median_time_to_first_answer_token_seconds` | 53% (105/200) |
| `performance.median_time_to_first_token_seconds` | 53% (105/200) |
| `evaluations.artificial_analysis_coding_index` | 35% (69/200) |
| `pricing.price_1m_cache_hit_tokens` | 31% (62/200) |
| `evaluations.artificial_analysis_agentic_index` | 25% (49/200) |
| `artificial_analysis_intelligence_index_cost.cost_per_task.total_cost` | 22% (44/200) |
| `artificial_analysis_intelligence_index_cost.total_cost` | 22% (44/200) |
| `pricing.price_1m_cache_write_tokens` | 9% (18/200) |

## text-to-image

- endpoint: `/media/text-to-image/models/free`
- status: 200 (tier `free`)
- modelos retornados: 148
- amostra: GPT Image 2 (high), Reve 2.1, Nano Banana 2 (Gemini 3.1 Flash Image Preview), GPT Image 1.5 (high), MAI-Image-2.5

| campo | preenchido em |
| --- | --- |
| `ci_95` | 100% (148/148) |
| `elo` | 100% (148/148) |
| `id` | 100% (148/148) |
| `model_creator.id` | 100% (148/148) |
| `model_creator.name` | 100% (148/148) |
| `name` | 100% (148/148) |
| `slug` | 100% (148/148) |

## image-editing

- endpoint: `/media/image-editing/models/free`
- status: 200 (tier `free`)
- modelos retornados: 67
- amostra: Reve 2.1, GPT Image 2 (high), MAI-Image-2.5, GPT Image 1.5 (high), Nano Banana 2 (Gemini 3.1 Flash Image Preview)

| campo | preenchido em |
| --- | --- |
| `ci_95` | 100% (67/67) |
| `elo` | 100% (67/67) |
| `id` | 100% (67/67) |
| `model_creator.id` | 100% (67/67) |
| `model_creator.name` | 100% (67/67) |
| `name` | 100% (67/67) |
| `slug` | 100% (67/67) |

## text-to-video

- endpoint: `/media/text-to-video/models/free`
- status: 200 (tier `free`)
- modelos retornados: 78
- amostra: Gemini Omni Flash, MiniMax H3, HappyHorse-1.0, Dreamina Seedance 2.0 720p, HappyHorse-1.1

| campo | preenchido em |
| --- | --- |
| `ci_95` | 100% (78/78) |
| `elo` | 100% (78/78) |
| `id` | 100% (78/78) |
| `model_creator.id` | 100% (78/78) |
| `model_creator.name` | 100% (78/78) |
| `name` | 100% (78/78) |
| `slug` | 100% (78/78) |

## image-to-video

- endpoint: `/media/image-to-video/models/free`
- status: 200 (tier `free`)
- modelos retornados: 72
- amostra: Gemini Omni Flash, MiniMax H3, Dreamina Seedance 2.0 720p, grok-imagine-video-1.5, grok-imagine-video

| campo | preenchido em |
| --- | --- |
| `ci_95` | 100% (72/72) |
| `elo` | 100% (72/72) |
| `id` | 100% (72/72) |
| `model_creator.id` | 100% (72/72) |
| `model_creator.name` | 100% (72/72) |
| `name` | 100% (72/72) |
| `slug` | 100% (72/72) |

## text-to-video-audio

- endpoint: `/media/text-to-video-audio/models/free`
- status: 200 (tier `free`)
- modelos retornados: 28
- amostra: Gemini Omni Flash, MiniMax H3, Dreamina Seedance 2.0 720p, Wan2.7-260612, HappyHorse-1.1

| campo | preenchido em |
| --- | --- |
| `ci_95` | 100% (28/28) |
| `elo` | 100% (28/28) |
| `id` | 100% (28/28) |
| `model_creator.id` | 100% (28/28) |
| `model_creator.name` | 100% (28/28) |
| `name` | 100% (28/28) |
| `slug` | 100% (28/28) |

## image-to-video-audio

- endpoint: `/media/image-to-video-audio/models/free`
- status: 200 (tier `free`)
- modelos retornados: 29
- amostra: Dreamina Seedance 2.0 720p, MiniMax H3, Gemini Omni Flash, grok-imagine-video-1.5, HappyHorse-1.1

| campo | preenchido em |
| --- | --- |
| `ci_95` | 100% (29/29) |
| `elo` | 100% (29/29) |
| `id` | 100% (29/29) |
| `model_creator.id` | 100% (29/29) |
| `model_creator.name` | 100% (29/29) |
| `name` | 100% (29/29) |
| `slug` | 100% (29/29) |


---

## Decisão (registrada a partir dos números acima)

**Texto/multimodal: dá para guiar decisão, com ressalva.** 200 modelos, índice de inteligência
em 99%. Mas a cobertura é desigual e a interface não pode fingir o contrário:

- preço em **68%** — 64 modelos não têm preço
- velocidade e latência em **53%** — quase metade sem medição
- índice de código em **35%**, agêntico em **25%**

Consequência de produto: campo ausente aparece como "sem dado", nunca como zero, e a
ordenação por preço ou velocidade precisa dizer quantos modelos ficaram fora dela.

**Imagem e vídeo: só preferência humana.** As seis modalidades de mídia devolvem
exatamente sete campos: `id`, `slug`, `name`, `model_creator.{id,name}`, `elo`, `ci_95`.
Sem preço, sem velocidade, sem amostra, sem data de lançamento, sem rank.

Consequência de produto: não é possível montar guia de decisão para imagem e vídeo com o
tier gratuito. O que é honesto publicar é um ranking de **preferência humana** com o
intervalo de confiança de 95% visível ao lado de cada Elo, rotulado como o que é — voto de
gente comparando pares, não capacidade medida. Elo de modalidades diferentes não se compara
entre si, nem com o índice de inteligência da linha de texto.

**Escopo da Task 6, portanto:** catálogo completo para texto/multimodal; imagem e vídeo
entram como leaderboards de preferência com incerteza explícita. Preço e velocidade para
mídia só se houver acesso Pro, que não é premissa deste projeto.
