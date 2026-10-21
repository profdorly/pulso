import { describe, expect, it } from "vitest";
import { whatsappShareUrl } from "./shareUrl.js";

const texts = [
  "*Pulso · 21 de outubro de 2026*\n\n*Ação, decisão e computação*\n\nLeia no Pulso:\nhttps://pulso.dorly.com.br/2026-10-21/#n-abc",
  "Emoji 🚀 e acentos: ç ã é ü ñ",
  "Símbolos & + # % = ? ; : / @ , $ ! ' ( ) * ~",
  "Tab\there, \"aspas\" e <script>alert(1)</script>",
  "Barras \\ ` ^ { | } [ ]\u007f e controle \u0001",
  "https://example.com/a?a=1&b=2#x",
  "50% de desconto + frete grátis",
  "surrogate solto: \ud800 fim",
];

describe("whatsappShareUrl", () => {
  it("delivers the text WhatsApp would get from encodeURIComponent", () => {
    for (const text of texts) {
      const href = whatsappShareUrl(text);
      expect(href.startsWith("https://wa.me/?text=")).toBe(true);
      expect(new URL(href).searchParams.get("text")).toBe(text.toWellFormed());
      expect([...new URL(href).searchParams.keys()]).toEqual(["text"]);
    }
  });

  it("leaves no space, line break or fragment raw in the link", () => {
    for (const text of texts) {
      const query = whatsappShareUrl(text).slice("https://wa.me/?text=".length);
      expect(query).not.toMatch(/[\s#"<>&]/);
    }
  });

  it("is shorter than escaping every character", () => {
    const text = texts[0]!;
    expect(whatsappShareUrl(text).length).toBeLessThan(`https://wa.me/?text=${encodeURIComponent(text)}`.length);
  });
});
