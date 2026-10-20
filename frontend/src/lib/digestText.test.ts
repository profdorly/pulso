import { describe, expect, it } from "vitest";
import { withoutOutletPrefix } from "./digestText.js";

describe("withoutOutletPrefix", () => {
  it("strips a labelled outlet before a colon", () => {
    expect(
      withoutOutletPrefix(
        "Olhar Digital: “Folha de S.Paulo entra com processo contra Perplexity” coloca os direitos autorais no centro do debate no Brasil.",
        "Olhar Digital"
      )
    ).toBe(
      "“Folha de S.Paulo entra com processo contra Perplexity” coloca os direitos autorais no centro do debate no Brasil."
    );
  });

  it("strips an outlet that is the grammatical subject", () => {
    expect(
      withoutOutletPrefix(
        "The Register alerta para anúncios falsos do OpenAI Codex que levam desenvolvedores de Mac a instalar malware.",
        "The Register"
      )
    ).toBe(
      "Alerta para anúncios falsos do OpenAI Codex que levam desenvolvedores de Mac a instalar malware."
    );
  });

  it("leaves text that does not start with the outlet", () => {
    expect(withoutOutletPrefix("O guia entra na capa agora.", "Tecnoblog")).toBe(
      "O guia entra na capa agora."
    );
  });
});
