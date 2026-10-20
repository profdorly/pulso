import { describe, expect, it } from "vitest";
import { outletFailures, pipelineWarnings } from "./failures.js";

describe("failure partitions", () => {
  it("keeps outlets apart from pipeline steps", () => {
    const failures = [
      { sourceId: "tecnoblog", name: "Tecnoblog", error: "timeout" },
      { sourceId: "pulso-evidence", name: "Evidência", error: "1 texto sem suporte" },
    ];
    expect(outletFailures(failures).map((row) => row.sourceId)).toEqual(["tecnoblog"]);
    expect(pipelineWarnings(failures).map((row) => row.sourceId)).toEqual(["pulso-evidence"]);
  });
});
