import { describe, expect, it } from "vitest";
import { detectGenre } from "./genre.js";

const NEWS_URL = "https://tecnoblog.net/noticias/gpt-5-6";

describe("detectGenre", () => {
  it("catches the marker the outlet puts at the front of the headline", () => {
    // Taken from a real edition: this column was published as if it were a news item.
    expect(
      detectGenre(
        "OPINIÃO: O jurídico não precisa só de IA. Precisa de dados confiáveis",
        "https://mittechreview.com.br/opiniao-o-juridico-nao-precisa-so-de-ia/"
      )
    ).toBe("opinion");
  });

  it("matches regardless of accent and case", () => {
    expect(detectGenre("opiniao: um argumento", NEWS_URL)).toBe("opinion");
    expect(detectGenre("Opinião — um argumento", NEWS_URL)).toBe("opinion");
    expect(detectGenre("EDITORIAL | a posição do jornal", NEWS_URL)).toBe("opinion");
    expect(detectGenre("Analysis: what the launch means", NEWS_URL)).toBe("opinion");
  });

  it("reads the publisher's own section from the path", () => {
    expect(detectGenre("O que muda com o novo modelo", "https://x.example/opinion/ai-models")).toBe(
      "opinion"
    );
    expect(detectGenre("O que muda", "https://x.example/colunas/alguem/ia")).toBe("opinion");
  });

  it("leaves reporting alone, including headlines that merely contain the words", () => {
    // False positives are the expensive mistake: they demote and mislabel real reporting.
    expect(detectGenre("Zhipu lança o GLM-5.3", NEWS_URL)).toBe("news");
    expect(detectGenre("Analytics platform ganha recursos de IA", NEWS_URL)).toBe("news");
    expect(detectGenre("Empresa divide opiniões com novo preço", NEWS_URL)).toBe("news");
    expect(detectGenre("Coluna vertebral: IA na medicina", NEWS_URL)).toBe("news");
    expect(detectGenre("Nova função do ChatGPT registra tudo", "https://x.example/ia/chatgpt")).toBe(
      "news"
    );
  });

  it("does not treat an unparseable url as a section hint", () => {
    expect(detectGenre("Uma notícia", "nao-e-url")).toBe("news");
  });
});
