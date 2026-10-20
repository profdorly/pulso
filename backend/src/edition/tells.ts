/**
 * Deterministic detector for the AI tells the humanizer exists to remove.
 *
 * The style pass used to rewrite every item text in the edition: at fifty items a day that is
 * nine model calls whose output is the whole edition echoed back, the second most expensive step
 * after the auditor. Most of it was spent on copy that was already clean, because the writers
 * work under the same rules. This decides which texts are worth a revision call, and tells the
 * revision exactly which words to fix.
 *
 * It errs toward flagging. A false positive costs one short revision; a false negative publishes
 * a text that skipped only a style pass, never a factual control — the evidence gate and the
 * auditor run after the humanizer either way. What it must not do is flag ordinary journalism, so
 * the rules leave alone the legitimate uses measured on the archive: "jornada de trabalho",
 * "direitos fundamentais", "marco regulatório", "Jornada ao Oeste", one dash pair around an
 * aside, a gerund that carries a fact (", elevando a avaliação para US$ 21 bilhões").
 *
 * The rules mirror `HUMANIZE_SYSTEM_PROMPT` and the writers' `WRITER_STYLE_RULES`; a tell added
 * to one belongs in the others.
 */

export type TellId =
  | "antitese"
  | "travessao"
  | "vocabulario"
  | "copula"
  | "conectores"
  | "ressalva"
  | "cliche"
  | "gerundio"
  | "emoji";

export interface AiTell {
  id: TellId;
  /** The words that triggered the rule, as they appear in the text. */
  excerpt: string;
}

/** Short PT-BR names, sent to the humanizer next to each excerpt. */
export const TELL_LABELS: Record<TellId, string> = {
  antitese: "antítese 'não é X, é Y'",
  travessao: "travessão em série",
  vocabulario: "vocabulário inflado",
  copula: "verbo pomposo no lugar de 'é'",
  conectores: "conector de redação escolar",
  ressalva: "'é importante ressaltar' e afins",
  cliche: "clichê ou jargão",
  gerundio: "gerúndio de enfeite no fim da frase",
  emoji: "emoji",
};

/** Word boundaries that understand accents; `\b` treats "é" and "ã" as non-word characters. */
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;

/**
 * Case-insensitive alternatives. Vocabulary uses `lowercase` instead, so a capitalised proper
 * noun ("Jornada ao Oeste") is not read as the metaphor.
 */
function words(...patterns: string[]): RegExp {
  return new RegExp(`${START}(?:${patterns.join("|")})${END}`, "iu");
}

function lowercase(...patterns: string[]): RegExp {
  return new RegExp(`${START}(?:${patterns.join("|")})${END}`, "u");
}

const PATTERNS: Array<[TellId, RegExp]> = [
  [
    "antitese",
    words(
      // "Não é só um guia, é um marco" / "O problema não é o modelo, mas o uso"
      String.raw`não (?:é|são)(?: (?:apenas|só|somente|mais|sobre))?[^.;:!?]{1,90}?, (?:é|são|e sim|mas (?:sim|o|a|os|as|um|uma))`,
      // "Não se trata apenas de X, mas de Y"
      String.raw`não se trata(?: (?:apenas|só|somente))? de[^.;:!?]{1,90}?, (?:mas|e sim)`,
      // "Não apenas X, mas também Y"
      String.raw`não (?:apenas|só|somente)[^.;:!?]{1,90}?,? mas(?: também)?`,
      // "Mais do que um software, é um parceiro"
      String.raw`mais (?:do )?que (?:um|uma|apenas|só|simples)[^.;:!?]{1,70}?, (?:é|são|trata-se)`
    ),
  ],
  [
    "vocabulario",
    lowercase(
      // The metaphor ("nossa jornada", "jornada rumo a"), not the working day.
      String.raw`(?:nossa|sua|uma|essa|esta|longa) jornada(?! (?:de trabalho|dupla|semanal|laboral|diária|de \d))`,
      String.raw`jornada (?:rumo|em direção|de transformação|de aprendizado|de inovação|digital|do cliente|de compra)`,
      "essência",
      "tapeçaria",
      "desbravar",
      "desvendar",
      "divisor de águas",
      "crucial",
      "cruciais",
      "fascinantes?",
      "robust[oa]s?",
      "inovador(?:a|es|as)?",
      "disruptiv[oa]s?",
      "revolucionar",
      "revolucionári[oa]s?",
      "ímpar",
      "inegável",
      "indiscutível",
      "pujante",
      "vibrante"
    ),
  ],
  [
    "vocabulario",
    words(
      // Predicative or "papel" use only: "direitos fundamentais" and "pesquisa fundamental"
      // are ordinary vocabulary.
      String.raw`(?:é|são|será|seria|foi|era|torna-se|tornou-se|considerad[oa]s?|papel|peça|passo|ponto|elemento|aspecto|fator)(?: (?:um|uma|o|a))? (?:fundamenta(?:l|is)|essencia(?:l|is)|vita(?:l|is))`,
      // "é um marco", not "marco regulatório", "marco legal" or "Marco Civil".
      String.raw`(?:é|representa|marca|configura|constitui|foi|será|seria) (?:um |o )?(?:verdadeiro |novo |importante |grande )?marco(?! (?:regulat|legal|civil|normativ|volunt|de governan))`,
      "marco histórico"
    ),
  ],
  [
    "copula",
    words(
      "configura-se",
      "se configuram? como",
      "apresenta-se como",
      "estabelece-se como",
      "se estabelece como",
      "consolida-se como",
      "se consolida como",
      "posiciona-se como",
      "revela-se",
      "caracteriza-se"
    ),
  ],
  [
    "ressalva",
    words(
      "é (?:importante|fundamental|essencial) (?:ressaltar|destacar|notar|lembrar|mencionar|observar|frisar|entender)",
      "vale (?:a pena )?(?:destacar|ressaltar|lembrar|notar|mencionar|observar|frisar)",
      "cabe (?:destacar|ressaltar|mencionar|lembrar|notar|observar)",
      "convém (?:lembrar|destacar|ressaltar|notar)",
      "não podemos esquecer",
      "destaca-se que",
      "ressalta-se que"
    ),
  ],
  [
    "cliche",
    words(
      "alavanc(?:ar|a|am|ou|ando)",
      "potencializ(?:ar|a|am|ou|ando)",
      "destrav(?:ar|a|am|ou|ando)",
      "entregar valor",
      "mindset",
      "nos dias de hoje",
      "hoje em dia",
      "em suma",
      "em conclusão",
      "o futuro é promissor",
      // Vague attribution only; "segundo especialistas ouvidos pela TechCrunch" names a source.
      String.raw`segundo especialistas(?! (?:ouvid|consultad|entrevistad|d[aoe]s? ))`,
      "uma série de",
      "uma gama de",
      "uma variedade de",
      "inúmer[oa]s",
      "vamos explorar",
      "a verdadeira questão",
      "em última análise",
      "no cerne",
      "endereç(?:ar|a|am|ou|ando)",
      "no final do dia",
      "em um movimento que",
      "no mundo atual",
      "um novo patamar"
    ),
  ],
  [
    "gerundio",
    // Decorative participles only. ", elevando a avaliação para US$ 21 bi" carries a fact and
    // stays; ", sinalizando a chegada do formato" is the tell.
    new RegExp(
      `,\\s*(?:garantindo|proporcionando|possibilitando|contribuindo|consolidando|reforçando|evidenciando|sinalizando|refletindo|marcando|promovendo|simbolizando)${END}`,
      "iu"
    ),
  ],
  // ©, ® and ™ are pictographic in Unicode but belong to product names, not to decoration.
  ["emoji", /(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}/u],
];

/** Sentence-initial connectors that read like a school essay even once. */
const STRONG_CONNECTOR =
  /(?:^|[.!?]\s+)(Além disso|Ademais|Dessa forma|Desse modo|Nesse sentido|Assim sendo|Dito isso|Outrossim|Em suma|Em resumo)(?![\p{L}\p{N}])/u;

/** Ordinary connectors; a tell only in a chain. */
const ANY_CONNECTOR =
  /(?:^|[.!?]\s+)(Além disso|Ademais|Dessa forma|Desse modo|Nesse sentido|Assim sendo|Dito isso|Outrossim|Em suma|Em resumo|Portanto|Ou seja|Por outro lado|No entanto|Contudo|Todavia|Entretanto|Com isso|Assim)(?![\p{L}\p{N}])/gu;

/** Em dashes and spaced en dashes; an unspaced en dash is a range ("2024–2025"). */
const DASH = /—|\s–\s/g;

const ORDER = Object.keys(TELL_LABELS) as TellId[];

/**
 * Tells found in `text`, one per rule, in a stable order. Empty means nothing worth a revision.
 *
 * One dash pair around an aside is standard Brazilian prose; three dashes in one text is the tell.
 */
export function findAiTells(text: string | undefined): AiTell[] {
  if (!text?.trim()) return [];
  const found = new Map<TellId, string>();

  for (const [id, pattern] of PATTERNS) {
    if (found.has(id)) continue;
    const match = pattern.exec(text);
    if (match) found.set(id, match[0].trim());
  }

  if ((text.match(DASH) ?? []).length >= 3) found.set("travessao", "—");

  const strong = STRONG_CONNECTOR.exec(text);
  const chain = [...text.matchAll(ANY_CONNECTOR)].map((match) => match[1]);
  if (strong) found.set("conectores", strong[1]);
  else if (chain.length >= 2) found.set("conectores", chain.join(" … "));

  return ORDER.filter((id) => found.has(id)).map((id) => ({ id, excerpt: found.get(id) ?? "" }));
}

export function hasAiTells(text: string | undefined): boolean {
  return findAiTells(text).length > 0;
}
