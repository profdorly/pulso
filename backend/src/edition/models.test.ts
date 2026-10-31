import { describe, expect, it } from "vitest";
import { priceFor } from "./cost.js";
import {
  PULSO_EDITORIAL_MODEL,
  PULSO_WORKER_MODEL,
  pulsoModelNames,
} from "./models.js";

describe("pulsoModelNames", () => {
  it("defaults editorial to GPT-6.1 Sol and the worker to GPT-6 Luna", () => {
    expect(PULSO_EDITORIAL_MODEL).toBe("gpt-6.1-sol");
    expect(PULSO_WORKER_MODEL).toBe("gpt-6-luna");
    expect(pulsoModelNames()).toEqual({
      editorial: PULSO_EDITORIAL_MODEL,
      worker: PULSO_WORKER_MODEL,
    });
  });

  it("prices every default, so the spend ceiling counts them", () => {
    for (const model of [PULSO_EDITORIAL_MODEL, PULSO_WORKER_MODEL]) {
      expect(priceFor(model), model).toBeDefined();
    }
  });

  it("does not let OPENAI_MODEL demote the editorial model", () => {
    expect(pulsoModelNames({ OPENAI_MODEL: "gpt-5.6-luna" })).toEqual({
      editorial: PULSO_EDITORIAL_MODEL,
      worker: "gpt-5.6-luna",
    });
  });

  it("honors per-role overrides", () => {
    expect(
      pulsoModelNames({
        OPENAI_MODEL_EDITORIAL: "gpt-5.6-sol",
        OPENAI_MODEL_WORKER: "gpt-5.6-luna",
      })
    ).toEqual({
      editorial: "gpt-5.6-sol",
      worker: "gpt-5.6-luna",
    });
  });
});
