import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { MethodologyPage } from "./MethodologyPage.js";

/**
 * The methodology page is the one made to be quoted, so what it must not say matters as much as
 * what it says.
 */
const html = renderToStaticMarkup(
  <MemoryRouter>
    <MethodologyPage />
  </MemoryRouter>
);
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("MethodologyPage limit declarations", () => {
  it("still refuses to promise absolute accuracy", () => {
    expect(text).toContain("não promete acurácia absoluta");
  });

  it("states what is not verified", () => {
    expect(text).toContain("O que não é verificado");
  });

  it("describes only features the site has: no topics, threads or status page", () => {
    expect(text).not.toContain("vocabulário fechado");
    expect(text).not.toContain("Antes nesta história");
    expect(html).not.toContain('href="/status');
  });

  it("links the pages it names at their served address", () => {
    expect(html).toContain('href="/modelos/"');
    expect(html).toContain('href="/arquivo/"');
    expect(html).toContain('href="/feed.xml"');
  });
});
