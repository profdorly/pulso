import { describe, expect, it } from "vitest";
import { PULSO_DATA_SCRIPT_ID, readPreloadedData } from "./editionData.js";

describe("readPreloadedData", () => {
  it("reads the prerendered JSON block and ignores an empty root", () => {
    const root = document.createElement("div");
    expect(readPreloadedData(root)).toBeNull();

    const script = document.createElement("script");
    script.id = PULSO_DATA_SCRIPT_ID;
    script.type = "application/json";
    script.textContent = JSON.stringify({ notFound: true });
    root.append(script);

    expect(readPreloadedData(root)).toEqual({ notFound: true });
  });
});
