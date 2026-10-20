---
name: pulso-copy
description: >-
  Revise Pulso PT-BR copy (capa, lede, bullets, blurbs, UI) with the
  humanizador before it is published. Use when writing or editing edition
  text, headlines, digest, or any Portuguese string that will appear on
  the Pulso site.
---

# Cópia do Pulso

Todo texto em português que for para o site passa pelo Humanizador **antes** de ser gravado na edição.

1. Leia e siga [`.cursor/skills/humanizador/SKILL.md`](../humanizador/SKILL.md).
2. Registro: editorial de jornal, citado, opinião cabível, sem release de assessoria.
3. Preserve fatos, URLs e nomes de veículos. Não invente.
4. Headline curta; lede de 2 a 4 frases; blurb de uma frase.

O publisher já aplica a mesma revisão em runtime (`backend/src/edition/humanize.ts`) depois do editorial da Terra — headline, lede, bullets e blurbs. Se você mudar as regras da skill, atualize `backend/src/edition/humanizePrompt.ts` para as duas camadas continuarem iguais.
