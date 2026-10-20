import type { AuditVerdict } from "./auditor.js";

/**
 * Measured evaluation of the auditor, before it is allowed to reject anything.
 *
 * "Is their API good enough?" is not answerable by reading a model card. It is answerable by
 * feeding the auditor summaries whose faults are known in advance and counting what it catches
 * and what it invents. Same approach as `research/aa-coverage.md`: decide on measurement.
 *
 * The two rates matter in opposite directions and both have teeth:
 *
 *   **Detection** — seeded faults it catches. A miss publishes something the article does not
 *   support, which is the failure the whole pipeline exists to prevent.
 *
 *   **False positives** — faithful summaries it rejects. Every one of those deletes a good
 *   paragraph. An auditor at 100% detection that flags half the clean cases makes the product
 *   worse, so the clean cases are half the corpus rather than an afterthought.
 *
 * Every body below is synthetic. They read like real coverage on purpose — the auditor has to
 * work on ordinary prose — but no case reports a real event, so nothing here can be mistaken
 * for reporting.
 */

export type FaultKind =
  | "clean"
  | "omission"
  | "number-swap"
  | "unsupported-claim"
  | "attribution-error"
  | "modality-drift"
  | "date-drift"
  | "entity-swap";

export interface EvalCase {
  id: string;
  /** Language of the article body; the summary is always Portuguese. */
  bodyLanguage: "en" | "pt";
  fault: FaultKind;
  /** True when a correct auditor answers `supported: true`. */
  expectSupported: boolean;
  title: string;
  outlet: string;
  body: string;
  summary: string;
  /** What a correct rejection should point at; for reading the report, not for scoring. */
  note?: string;
}

const EN_LAUNCH_BODY = `Northwind AI said on Tuesday that it is opening a waiting list for Harbor 2, its
document-processing model, and plans to make the model generally available later this quarter. The company
said pricing will start at 4 dollars per million input tokens once general availability begins, and that
customers on the waiting list will get access in batches. Harbor 2 handles documents up to 300 pages, up
from 80 pages in the previous version. Northwind's head of product, Lena Ortiz, said the waiting list is
intended to keep latency stable while capacity is added. The company did not say how many customers are on
the list, and declined to comment on whether the model will be offered through cloud marketplaces.`;

const EN_POLICY_BODY = `The European Commission published draft guidance on Wednesday describing how providers
of general-purpose AI models should document training data. The draft asks providers to publish a summary of
data sources by category rather than an itemised list, and sets a six-month window for compliance after the
guidance is finalised. Industry groups have until 14 September to submit comments. The Commission said the
guidance does not create new obligations beyond the existing regulation, and that it expects to publish the
final text before the end of the year. A spokesperson said enforcement priorities for the first year will
focus on documentation rather than penalties.`;

const PT_PRODUCT_BODY = `A Vetorial, empresa brasileira de infraestrutura de dados, anunciou nesta segunda-feira
uma integração entre seu catálogo e assistentes de código. Segundo a companhia, a integração permite que o
assistente consulte metadados de tabelas antes de sugerir uma consulta, o que reduz erro de nome de coluna.
A empresa afirmou que a funcionalidade está em prévia fechada com sete clientes e que a abertura geral
depende de testes de carga. A Vetorial não divulgou preço e disse que a cobrança será por volume de
consultas. A companhia informou ainda que a integração funciona apenas com bancos PostgreSQL nesta fase.`;

const EN_BENCH_BODY = `Cavendish Labs released results for its internal reasoning benchmark on Thursday, reporting
that its Solstice model scored 71.4 on the suite, ahead of the 68.9 it recorded three months ago. The lab said
the benchmark is not directly comparable to public leaderboards because it uses a private question set. Cavendish
also said it will not publish per-question results, citing contamination risk. An independent researcher, Priya
Raman, said the gain is consistent with a longer context window rather than a change in reasoning, and that she
would want to see held-out results before drawing conclusions.`;

export const EVAL_CASES: EvalCase[] = [
  {
    id: "clean-launch",
    bodyLanguage: "en",
    fault: "clean",
    expectSupported: true,
    title: "Northwind opens waiting list for Harbor 2",
    outlet: "Wired",
    body: EN_LAUNCH_BODY,
    summary:
      "A Northwind AI abriu uma lista de espera para o Harbor 2, seu modelo de processamento de documentos, e pretende liberar o modelo de forma geral ainda neste trimestre. O acesso será concedido em lotes, e o preço anunciado começa em 4 dólares por milhão de tokens de entrada quando a disponibilidade geral começar.\n\nO Harbor 2 processa documentos de até 300 páginas, contra 80 da versão anterior. A empresa não informou quantos clientes estão na lista.",
  },
  {
    id: "clean-policy",
    bodyLanguage: "en",
    fault: "clean",
    expectSupported: true,
    title: "Commission publishes draft guidance on training data",
    outlet: "The Guardian",
    body: EN_POLICY_BODY,
    summary:
      "A Comissão Europeia publicou uma minuta de orientação sobre como fornecedores de modelos de uso geral devem documentar dados de treinamento. O texto pede um resumo das fontes por categoria, em vez de lista item por item, e prevê seis meses para adequação depois de finalizado.\n\nGrupos do setor podem enviar comentários até 14 de setembro. A Comissão afirmou que a orientação não cria obrigações além da regulação existente.",
  },
  {
    id: "clean-pt",
    bodyLanguage: "pt",
    fault: "clean",
    expectSupported: true,
    title: "Vetorial integra catálogo de dados a assistentes de código",
    outlet: "Tecnoblog",
    body: PT_PRODUCT_BODY,
    summary:
      "A Vetorial anunciou uma integração entre seu catálogo de dados e assistentes de código, que consulta metadados de tabelas antes de sugerir uma consulta para reduzir erro de nome de coluna. A funcionalidade está em prévia fechada com sete clientes, e a abertura geral depende de testes de carga.\n\nA empresa não divulgou preço e disse que a cobrança será por volume de consultas. Nesta fase, a integração funciona apenas com bancos PostgreSQL.",
  },
  {
    id: "omission-bench",
    bodyLanguage: "en",
    fault: "omission",
    expectSupported: true,
    title: "Cavendish reports 71.4 on internal reasoning benchmark",
    outlet: "IEEE Spectrum",
    body: EN_BENCH_BODY,
    summary:
      "A Cavendish Labs divulgou resultados do seu benchmark interno de raciocínio e afirmou que o modelo Solstice marcou 71,4 na suíte, acima dos 68,9 de três meses antes. O laboratório disse que o número não é diretamente comparável a rankings públicos porque o conjunto de perguntas é privado.",
    note: "Omite a crítica da pesquisadora independente. Resumo incompleto não é resumo errado.",
  },
  {
    id: "omission-policy",
    bodyLanguage: "en",
    fault: "omission",
    expectSupported: true,
    title: "Commission publishes draft guidance on training data",
    outlet: "The Guardian",
    body: EN_POLICY_BODY,
    summary:
      "A Comissão Europeia publicou uma minuta de orientação sobre documentação de dados de treinamento para modelos de uso geral. O texto pede resumo das fontes por categoria em vez de lista item por item.",
    note: "Só o essencial, sem prazo nem consulta pública. Nada afirmado é falso.",
  },
  {
    id: "number-swap-price",
    bodyLanguage: "en",
    fault: "number-swap",
    expectSupported: false,
    title: "Northwind opens waiting list for Harbor 2",
    outlet: "Wired",
    body: EN_LAUNCH_BODY,
    summary:
      "A Northwind AI abriu lista de espera para o Harbor 2 e pretende liberar o modelo neste trimestre. O preço começa em 40 dólares por milhão de tokens de entrada.\n\nO modelo processa documentos de até 300 páginas.",
    note: "4 dólares virou 40. Moeda em prosa sem símbolo entrou na extração do gate, então ele pega esse; serve de piso de sanidade.",
  },
  {
    id: "number-swap-pages",
    bodyLanguage: "en",
    fault: "number-swap",
    expectSupported: false,
    title: "Northwind opens waiting list for Harbor 2",
    outlet: "Wired",
    body: EN_LAUNCH_BODY,
    summary:
      "A Northwind AI abriu lista de espera para o Harbor 2. O modelo processa documentos de até 300 páginas, contra 180 da versão anterior, e o preço começa em 4 dólares por milhão de tokens de entrada.",
    note: "80 páginas da versão anterior virou 180.",
  },
  {
    id: "modality-launch",
    bodyLanguage: "en",
    fault: "modality-drift",
    expectSupported: false,
    title: "Northwind opens waiting list for Harbor 2",
    outlet: "Wired",
    body: EN_LAUNCH_BODY,
    summary:
      "A Northwind AI lançou o Harbor 2 nesta terça-feira, com disponibilidade geral imediata e preço a partir de 4 dólares por milhão de tokens de entrada. O modelo processa documentos de até 300 páginas.",
    note: "A matéria diz lista de espera e intenção de liberar; o resumo afirma lançamento já disponível.",
  },
  {
    id: "modality-policy",
    bodyLanguage: "en",
    fault: "modality-drift",
    expectSupported: false,
    title: "Commission publishes draft guidance on training data",
    outlet: "The Guardian",
    body: EN_POLICY_BODY,
    summary:
      "A Comissão Europeia aprovou as regras finais sobre documentação de dados de treinamento, que passam a valer com prazo de seis meses para adequação. Grupos do setor podem comentar até 14 de setembro.",
    note: "Minuta em consulta virou regra final aprovada.",
  },
  {
    id: "attribution-quote",
    bodyLanguage: "en",
    fault: "attribution-error",
    expectSupported: false,
    title: "Cavendish reports 71.4 on internal reasoning benchmark",
    outlet: "IEEE Spectrum",
    body: EN_BENCH_BODY,
    summary:
      "A Cavendish Labs afirmou que o ganho do Solstice vem de uma janela de contexto mais longa e não de mudança no raciocínio, e que gostaria de ver resultados retidos antes de concluir. O modelo marcou 71,4 na suíte interna.",
    note: "A ressalva é da pesquisadora independente, não do laboratório.",
  },
  {
    id: "attribution-company",
    bodyLanguage: "pt",
    fault: "attribution-error",
    expectSupported: false,
    title: "Vetorial integra catálogo de dados a assistentes de código",
    outlet: "Tecnoblog",
    body: PT_PRODUCT_BODY,
    summary:
      "A Vetorial anunciou que sua integração com assistentes de código já está aberta a todos os clientes, segundo a Maritaca AI. A funcionalidade consulta metadados de tabelas antes de sugerir uma consulta.",
    note: "Atribui a fala a uma empresa que não aparece na matéria, e abre a prévia fechada.",
  },
  {
    id: "unsupported-market",
    bodyLanguage: "en",
    fault: "unsupported-claim",
    expectSupported: false,
    title: "Northwind opens waiting list for Harbor 2",
    outlet: "Wired",
    body: EN_LAUNCH_BODY,
    summary:
      "A Northwind AI abriu lista de espera para o Harbor 2, que processa documentos de até 300 páginas. A empresa lidera o mercado de processamento de documentos e o modelo será oferecido nos principais marketplaces de nuvem.",
    note: "Liderança de mercado não está no texto, e a matéria diz que a empresa se recusou a comentar sobre marketplaces.",
  },
  {
    id: "unsupported-context",
    bodyLanguage: "pt",
    fault: "unsupported-claim",
    expectSupported: false,
    title: "Vetorial integra catálogo de dados a assistentes de código",
    outlet: "Tecnoblog",
    body: PT_PRODUCT_BODY,
    summary:
      "A Vetorial anunciou integração entre catálogo e assistentes de código, em prévia fechada com sete clientes. A empresa recebeu investimento de 30 milhões de reais no ano passado para acelerar o produto.",
    note: "A rodada de investimento não aparece em lugar nenhum da matéria.",
  },
  {
    id: "date-drift",
    bodyLanguage: "en",
    fault: "date-drift",
    expectSupported: false,
    title: "Commission publishes draft guidance on training data",
    outlet: "The Guardian",
    body: EN_POLICY_BODY,
    summary:
      "A Comissão Europeia publicou a minuta de orientação sobre documentação de dados de treinamento. Grupos do setor têm até 14 de outubro para comentar, e o texto final é esperado para o começo do ano que vem.",
    note: "14 de setembro virou outubro; fim deste ano virou começo do ano que vem.",
  },
  {
    id: "entity-swap",
    bodyLanguage: "en",
    fault: "entity-swap",
    expectSupported: false,
    title: "Cavendish reports 71.4 on internal reasoning benchmark",
    outlet: "IEEE Spectrum",
    body: EN_BENCH_BODY,
    summary:
      "A Cavendish Labs divulgou que o modelo Solstice 2 marcou 71,4 no benchmark interno de raciocínio, acima dos 68,9 registrados três meses antes. O laboratório não vai publicar resultados por questão.",
    note: "O modelo é Solstice, não Solstice 2. Versão errada é o caso que o gate determinístico já cobre.",
  },

  // ---------------------------------------------------------------------------------------
  // Harder half. The blatant cases above turned out to be aced by the cheapest model, which
  // makes them useless for choosing between providers: a benchmark everyone passes measures
  // nothing. These are the cases that separate an auditor that reads from one that pattern-matches.
  // ---------------------------------------------------------------------------------------
  {
    id: "paraphrase-units",
    bodyLanguage: "en",
    fault: "clean",
    expectSupported: true,
    title: "Northwind opens waiting list for Harbor 2",
    outlet: "Wired",
    body: EN_LAUNCH_BODY,
    summary:
      "A Northwind AI abriu lista de espera para o Harbor 2 e pretende liberar o modelo de forma geral neste trimestre. O preço parte de US$ 4 por 1 milhão de tokens de entrada, e o modelo lê documentos de até 300 páginas — contra 80 na versão anterior.",
    note: "Mesma informação em outra notação. Auditor que casa string em vez de ler o sentido rejeita isto.",
  },
  {
    id: "spokesperson-institution",
    bodyLanguage: "en",
    fault: "clean",
    expectSupported: true,
    title: "Commission publishes draft guidance on training data",
    outlet: "The Guardian",
    body: EN_POLICY_BODY,
    summary:
      "A Comissão Europeia publicou minuta de orientação sobre documentação de dados de treinamento e afirmou que as prioridades de fiscalização do primeiro ano serão de documentação, não de multa. Grupos do setor podem comentar até 14 de setembro.",
    note: "A fala é de um porta-voz, e porta-voz fala pela instituição. Rejeitar isto é excesso de zelo.",
  },
  {
    id: "hedge-preserved",
    bodyLanguage: "en",
    fault: "clean",
    expectSupported: true,
    title: "Commission publishes draft guidance on training data",
    outlet: "The Guardian",
    body: EN_POLICY_BODY,
    summary:
      "A Comissão Europeia publicou a minuta e disse que espera publicar o texto final antes do fim do ano. A orientação prevê seis meses para adequação depois de finalizada, e a Comissão afirmou que não cria obrigações além da regulação existente.",
    note: "A ressalva foi preservada ('espera publicar'). Auditor não pode marcar tudo que fala de futuro.",
  },
  {
    id: "inference-cause",
    bodyLanguage: "en",
    fault: "unsupported-claim",
    expectSupported: false,
    title: "Northwind opens waiting list for Harbor 2",
    outlet: "Wired",
    body: EN_LAUNCH_BODY,
    summary:
      "A Northwind AI abriu lista de espera para o Harbor 2 depois de enfrentar instabilidade de latência, e pretende liberar o modelo neste trimestre. O modelo lê documentos de até 300 páginas.",
    note: "O texto diz que a lista serve para MANTER a latência estável, não que houve instabilidade. Inferência plausível e não sustentada — o caso mais difícil de todos.",
  },
  {
    id: "direction-flip",
    bodyLanguage: "en",
    fault: "number-swap",
    expectSupported: false,
    title: "Northwind opens waiting list for Harbor 2",
    outlet: "Wired",
    body: EN_LAUNCH_BODY,
    summary:
      "A Northwind AI abriu lista de espera para o Harbor 2, que processa documentos de no mínimo 300 páginas. O preço parte de 4 dólares por milhão de tokens de entrada.",
    note: "'até 300 páginas' virou 'no mínimo 300'. O número está certo e o sentido está invertido.",
  },
  {
    id: "scope-creep",
    bodyLanguage: "pt",
    fault: "unsupported-claim",
    expectSupported: false,
    title: "Vetorial integra catálogo de dados a assistentes de código",
    outlet: "Tecnoblog",
    body: PT_PRODUCT_BODY,
    summary:
      "A Vetorial anunciou integração entre seu catálogo e assistentes de código, e sete clientes já usam a funcionalidade em produção. A cobrança será por volume de consultas.",
    note: "Prévia fechada com sete clientes virou sete clientes em produção. Mesmo número, estágio diferente.",
  },
];

export interface CaseOutcome {
  id: string;
  fault: FaultKind;
  expectSupported: boolean;
  /** Null when the auditor failed or returned unusable output. */
  actualSupported: boolean | null;
  findings: number;
  error?: string;
}

export interface EvalScore {
  total: number;
  /** Cases where a fault was seeded. */
  seeded: number;
  /** Seeded faults the auditor rejected. */
  caught: number;
  /** Faithful summaries the auditor wrongly rejected. */
  falsePositives: number;
  /** Faithful summaries correctly accepted. */
  cleanPassed: number;
  clean: number;
  /** Calls that failed or returned unparseable output. */
  unusable: number;
  detectionRate: number;
  falsePositiveRate: number;
  byFault: Array<{ fault: FaultKind; seeded: number; caught: number }>;
}

/**
 * Scores outcomes.
 *
 * An unusable answer counts as a **miss** on a seeded case, never as a catch: an auditor that
 * crashes has not caught anything. On a clean case it is not counted as a false positive either,
 * since it did not reject the paragraph — it is reported on its own line instead, because a
 * flaky auditor is its own problem.
 */
export function scoreOutcomes(outcomes: CaseOutcome[]): EvalScore {
  const seededCases = outcomes.filter((row) => !row.expectSupported);
  const cleanCases = outcomes.filter((row) => row.expectSupported);

  const caught = seededCases.filter((row) => row.actualSupported === false).length;
  const falsePositives = cleanCases.filter((row) => row.actualSupported === false).length;
  const cleanPassed = cleanCases.filter((row) => row.actualSupported === true).length;
  const unusable = outcomes.filter((row) => row.actualSupported === null).length;

  const faults = [...new Set(seededCases.map((row) => row.fault))];
  const byFault = faults.map((fault) => {
    const rows = seededCases.filter((row) => row.fault === fault);
    return {
      fault,
      seeded: rows.length,
      caught: rows.filter((row) => row.actualSupported === false).length,
    };
  });

  return {
    total: outcomes.length,
    seeded: seededCases.length,
    caught,
    falsePositives,
    cleanPassed,
    clean: cleanCases.length,
    unusable,
    detectionRate: seededCases.length === 0 ? 0 : caught / seededCases.length,
    falsePositiveRate: cleanCases.length === 0 ? 0 : falsePositives / cleanCases.length,
    byFault,
  };
}

export function outcomeFrom(
  testCase: EvalCase,
  verdict: AuditVerdict | null,
  error?: string
): CaseOutcome {
  return {
    id: testCase.id,
    fault: testCase.fault,
    expectSupported: testCase.expectSupported,
    actualSupported: verdict === null ? null : verdict.supported,
    findings: verdict?.findings.length ?? 0,
    ...(error ? { error } : {}),
  };
}
