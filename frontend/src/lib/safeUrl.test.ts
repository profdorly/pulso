import { describe, expect, it } from "vitest";
import { externalHref } from "./safeUrl.js";

describe("externalHref", () => {
  it("keeps web addresses exactly as recorded", () => {
    expect(externalHref("https://example.com/a?b=1&c=2")).toBe("https://example.com/a?b=1&c=2");
    expect(externalHref("http://example.com")).toBe("http://example.com");
  });

  it("drops anything a browser would run or open locally", () => {
    for (const url of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>", "vbscript:x", "file:///etc/passwd", "/relative", "", undefined, null]) {
      expect(externalHref(url)).toBeUndefined();
    }
  });
});
