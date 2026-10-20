import { describe, expect, it } from "vitest";
import { parseVerdict } from "./auditor.js";
import { EVAL_CASES, outcomeFrom, scoreOutcomes, type CaseOutcome } from "./auditorEval.js";

function outcome(overrides: Partial<CaseOutcome> & Pick<CaseOutcome, "id">): CaseOutcome {
  return {
    fault: overrides.fault ?? "clean",
    expectSupported: overrides.expectSupported ?? true,
    actualSupported: overrides.actualSupported ?? true,
    findings: overrides.findings ?? 0,
    ...overrides,
  };
}

describe("EVAL_CASES", () => {
  it("keeps enough clean cases to make the false-positive rate meaningful", () => {
    const clean = EVAL_CASES.filter((row) => row.expectSupported);
    // An auditor is only useful if it accepts faithful summaries, so a corpus of nothing but
    // seeded faults would measure half of what matters.
    expect(clean.length).toBeGreaterThanOrEqual(4);
    expect(clean.length / EVAL_CASES.length).toBeGreaterThan(0.25);
  });

  it("includes the modality drift the deterministic gate cannot see", () => {
    // Numbers and versions are already covered for free by the claim gate. "Planeja lançar"
    // written as "lançou" has no number to compare, which is why the auditor exists.
    expect(EVAL_CASES.some((row) => row.fault === "modality-drift")).toBe(true);
  });

  it("tests summaries whose body is in another language, since that is the real risk", () => {
    const crossLingual = EVAL_CASES.filter((row) => row.bodyLanguage === "en");
    expect(crossLingual.length).toBeGreaterThan(EVAL_CASES.length / 2);
  });

  it("marks every seeded case as expecting rejection and every clean case as expecting a pass", () => {
    for (const row of EVAL_CASES) {
      const isClean = row.fault === "clean" || row.fault === "omission";
      expect(row.expectSupported).toBe(isClean);
    }
  });

  it("gives every case a distinct id", () => {
    const ids = EVAL_CASES.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("scoreOutcomes", () => {
  it("separates detection from false positives", () => {
    const score = scoreOutcomes([
      outcome({ id: "a", fault: "number-swap", expectSupported: false, actualSupported: false }),
      outcome({ id: "b", fault: "modality-drift", expectSupported: false, actualSupported: true }),
      outcome({ id: "c", actualSupported: true }),
      outcome({ id: "d", actualSupported: false }),
    ]);

    expect(score.seeded).toBe(2);
    expect(score.caught).toBe(1);
    expect(score.detectionRate).toBe(0.5);
    expect(score.clean).toBe(2);
    expect(score.falsePositives).toBe(1);
    expect(score.falsePositiveRate).toBe(0.5);
  });

  it("counts an unusable answer as a miss, never as a catch", () => {
    // An auditor that crashes has not caught anything. Treating a failed call as a rejection
    // would make a broken auditor score perfectly.
    const score = scoreOutcomes([
      outcome({
        id: "a",
        fault: "number-swap",
        expectSupported: false,
        actualSupported: null,
        error: "timeout",
      }),
    ]);

    expect(score.caught).toBe(0);
    expect(score.detectionRate).toBe(0);
    expect(score.unusable).toBe(1);
  });

  it("does not count an unusable answer on a clean case as a false positive", () => {
    // It did not reject the paragraph; it failed. Flakiness is reported on its own line.
    const score = scoreOutcomes([outcome({ id: "a", actualSupported: null, error: "500" })]);
    expect(score.falsePositives).toBe(0);
    expect(score.unusable).toBe(1);
  });

  it("breaks detection down per fault so a blind spot is visible", () => {
    const score = scoreOutcomes([
      outcome({ id: "a", fault: "number-swap", expectSupported: false, actualSupported: false }),
      outcome({ id: "b", fault: "modality-drift", expectSupported: false, actualSupported: true }),
      outcome({ id: "c", fault: "modality-drift", expectSupported: false, actualSupported: true }),
    ]);

    const modality = score.byFault.find((row) => row.fault === "modality-drift");
    expect(modality).toEqual({ fault: "modality-drift", seeded: 2, caught: 0 });
  });

  it("reports zero rates instead of dividing by nothing", () => {
    const score = scoreOutcomes([]);
    expect(score.detectionRate).toBe(0);
    expect(score.falsePositiveRate).toBe(0);
  });
});

describe("parseVerdict", () => {
  it("reads a bare JSON answer", () => {
    expect(parseVerdict('{"supported": true, "findings": []}')).toEqual({
      supported: true,
      findings: [],
    });
  });

  it("reads an answer wrapped in a code fence, which models add anyway", () => {
    const fenced = '```json\n{"supported": false, "findings": [{"excerpt": "40 dólares", "why": "o texto diz 4"}]}\n```';
    expect(parseVerdict(fenced)?.supported).toBe(false);
    expect(parseVerdict(fenced)?.findings[0]?.excerpt).toBe("40 dólares");
  });

  it("reads the JSON out of prose around it", () => {
    const prose =
      'Comparando os dois textos, o valor confere. {"supported": true, "findings": []} Fim da análise.';
    expect(parseVerdict(prose)).toEqual({ supported: true, findings: [] });
  });

  it("takes the last verdict when the model revises itself", () => {
    const revised =
      '{"supported": true, "findings": []}\nRevendo a data: ' +
      '{"supported": false, "findings": [{"excerpt": "em outubro", "why": "a matéria diz setembro"}]}';
    expect(parseVerdict(revised)?.supported).toBe(false);
    expect(parseVerdict(revised)?.findings[0]?.excerpt).toBe("em outubro");
  });

  it("ignores braces inside strings and stray braces in the prose", () => {
    const tricky =
      'Nota { sem fechar. {"supported": false, "findings": [{"excerpt": "a função {x}", "why": "não há } no texto"}]}';
    expect(parseVerdict(tricky)?.findings[0]?.excerpt).toBe("a função {x}");
  });

  it("accepts the fields in any order", () => {
    expect(parseVerdict('{"findings": [], "supported": true}')?.supported).toBe(true);
  });

  it("returns null when there is no verdict to read", () => {
    expect(parseVerdict("Não consegui avaliar.")).toBeNull();
    expect(parseVerdict('{"excerpt": "x", "why": "y"}')).toBeNull();
  });

  it("tolerates prose around the JSON", () => {
    const chatty = 'Aqui está o resultado:\n{"supported": true}\nEspero que ajude.';
    expect(parseVerdict(chatty)).toEqual({ supported: true, findings: [] });
  });

  it("returns null instead of guessing when there is no usable JSON", () => {
    expect(parseVerdict("O resumo parece bom para mim.")).toBeNull();
    expect(parseVerdict("")).toBeNull();
    expect(parseVerdict('{"supported": "talvez"}')).toBeNull();
  });
});

describe("outcomeFrom", () => {
  it("records an unusable verdict as null rather than as a pass", () => {
    const row = outcomeFrom(EVAL_CASES[0], null, "timeout");
    expect(row.actualSupported).toBeNull();
    expect(row.error).toBe("timeout");
  });
});
