# Poda de fontes RSS — medição de agosto de 2026

Candidatas a remoção medidas ao vivo antes de qualquer decisão: um request por feed,
contagem de itens e de itens com assunto de IA (regex por palavra-chave no título/resumo —
subestima fontes em PT/DE/FR, o que está anotado caso a caso). A distribuição por veículo
vem das edições reais publicadas em staging (`data/editions/2026-08-14` a `2026-08-21`).

## O que a distribuição real mostrou

| fonte | fatos medidos | decisão |
| --- | --- | --- |
| `nikkei-asia` | **6–8 itens por edição** saíram desse feed sozinhos (08-15 a 08-21); feed é o `nar` (site inteiro, negócios) | **removida** — o problema exato que `PRESS_SOURCE_CAP` existe para impedir, só que antes do cap existir |
| `heise` | 4–6 itens por edição, todos em alemão (podcast KI-Update); yield de IA baixo para leitor PT-BR | **removida** |
| `japan-times` | 25 itens amostrados, **0** sobre IA (bilheteria de filme no topo) | **removida** |
| `korea-herald` | 25 itens, **1** sobre IA | **removida** |
| `ft-tech` | o feed **funciona** (25 itens, 9 de IA) — mas o paywall derruba o download da página: as 4 matérias do FT publicadas em staging saíram **sem `summaryPt`**, ou seja, sem texto verificável | **removida** — vaga de imprensa com conteúdo que nunca passa pelo gate de evidência é o oposto da promessa do jornal |
| `mobile-time` | imprensa de telecom; 20 itens, **1** de IA | **removida** |
| `microsoft-azure` | PR corporativo (ex.: posicionamento em quadrante Gartner), não notícia; notícia de Microsoft chega pela imprensa | **removida** |

## O que a medição impediu de fazer

- **Cap por veículo nos primários (anúncios de lab).** O risco teórico era o Google, com 4
  feeds oficiais, tomar as vagas de anúncio. Nas edições reais os primários variam de 0 a 6
  por edição e o Google aparece no máximo 2 vezes. Não implementado — seria regra para um
  problema que não existe nos dados.
- **`the-register`** estava na lista de suspeitas por ser feed de site inteiro, mas o yield
  medido é 8/25 com itens de IA legítimos. Fica.

## Cobertura por região após a poda

| região | antes | depois |
| --- | --- | --- |
| Ásia | 7 | 4 (Pandaily, SCMP Tech, Sixth Tone, TechNode) |
| Brasil | 5 | 4 (MIT TR Brasil, Tecnoblog, Olhar Digital, Canaltech) |
| Europa | 7 | 5 (The Register, Sifted, Le Monde Pixels, Guardian Tech, + oficiais Mistral) |
| EUA | 12 | 11 |

Nenhuma região ficou dependente de um único veículo de imprensa. Repetir a medição com
`scripts/probe-feeds.mjs` quando uma região ameaçar ficar com menos de três fontes vivas.
