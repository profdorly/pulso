import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App.tsx";
import { EditionDataProvider, type PreloadedEditionData } from "./lib/editionData.js";
import type { PulsoEdition, PulsoIndex } from "./lib/edition.js";
import type { ModelCatalog } from "./lib/modelCatalog.js";
import { itemAnchor } from "./lib/itemPage.js";

const ORIGIN = "https://pulso.dorly.com.br";

const edition: PulsoEdition = {
  id: "2026-10-19-manha",
  schemaVersion: 1,
  slot: "manha",
  calendarDate: "2026-10-19",
  timezone: "America/Sao_Paulo",
  capturedAt: "2026-10-19T10:34:00.000Z",
  status: "ok",
  number: 101,
  predecessorId: "2026-10-18-manha",
  digest: {
    headline: "Tecnoblog e MIT TR Brasil cobrem o recorte local",
    lede: "O dia é brasileiro.",
    bullets: [
      {
        text: "O que muda para quem usa GPT-5.6 no trabalho",
        url: "https://tecnoblog.net/gpt-5-6-trabalho",
        outlet: "Tecnoblog",
      },
    ],
  },
  items: [
    {
      id: "0a1b2c3d4e5f60718293",
      title: "O que muda para quem usa GPT-5.6 no trabalho",
      blurbPt: "Guia prático em português.",
      url: "https://tecnoblog.net/gpt-5-6-trabalho",
      outlet: "Tecnoblog",
      region: "brazil",
      kind: "press",
      publishedAt: "2026-10-19T09:20:00.000Z",
      firstSeenAt: "2026-10-19T10:34:00.000Z",
    },
  ],
  sourceFailures: [],
  benchmarks: {
    capturedAt: "2026-10-19T11:00:00.000Z",
    previousCapturedAt: null,
    headline: [{ label: "Claude Opus 5", value: "63.0", delta: null }],
    attribution: ["Artificial Analysis"],
    rows: [
      {
        modelId: "claude-opus-5",
        name: "Claude Opus 5",
        creator: "Anthropic",
        intelligenceIndex: 63,
        priceInput: 5,
        throughput: 53,
      },
    ],
  },
  models: { discovery: "gpt-5.6-terra", editorial: "gpt-6.1-sol", worker: "gpt-6-luna" },
  costUsdApprox: 0,
  cover: {
    path: "2026-10-19/manha.cover-r1.svg",
    alt: "PULSO · 19 OUT 2026: Tecnoblog e MIT TR Brasil cobrem o recorte local",
    width: 1200,
    height: 675,
  },
};

/** The day before. Distinct headline and item: any mix-up between the two has to show. */
const older: PulsoEdition = {
  ...edition,
  id: "2026-10-18-manha",
  calendarDate: "2026-10-18",
  capturedAt: "2026-10-18T10:33:00.000Z",
  number: 100,
  predecessorId: null,
  digest: { headline: "O anúncio do laboratório", lede: "O dia é do anúncio.", bullets: [] },
  items: [
    {
      id: "ffeeddccbbaa99887766",
      title: "Lab announces the morning model",
      blurbPt: "Anúncio do dia.",
      url: "https://openai.com/blog/morning-model",
      outlet: "OpenAI",
      region: "us",
      kind: "lab",
      publishedAt: "2026-10-18T09:00:00.000Z",
      firstSeenAt: "2026-10-18T10:33:00.000Z",
    },
  ],
};

const index: PulsoIndex = {
  schemaVersion: 1,
  latestId: edition.id,
  editions: [
    {
      id: edition.id,
      slot: "manha",
      calendarDate: edition.calendarDate,
      capturedAt: edition.capturedAt,
      number: 101,
      headline: edition.digest.headline,
      path: "/2026-10-19/",
    },
    {
      id: older.id,
      slot: "manha",
      calendarDate: older.calendarDate,
      capturedAt: older.capturedAt,
      number: 100,
      headline: older.digest.headline,
      path: "/2026-10-18/",
    },
  ],
};

const AA_METHODOLOGY = "https://artificialanalysis.ai/methodology";
/**
 * Deliberately uneven, like the real capture: one model with a price, one without, and a
 * media arena that publishes only Elo. The page must show the gap as a gap.
 */
const catalog: ModelCatalog = {
  schemaVersion: 1,
  capturedAt: "2026-10-19T02:00:00.000Z",
  sources: ["artificial-analysis"],
  sections: [
    {
      modality: "language",
      group: "texto",
      availableMetrics: ["intelligence-index", "price-input-1m"],
      models: [
        {
          id: "claude-opus-5",
          name: "Claude Opus 5",
          creator: "Anthropic",
          modality: "language",
          observations: [
            {
              metric: "intelligence-index",
              value: 63,
              source: "artificial-analysis",
              benchmark: "Artificial Analysis Intelligence Index",
              capturedAt: "2026-10-19T02:00:00.000Z",
              methodologyUrl: AA_METHODOLOGY,
            },
            {
              metric: "price-input-1m",
              value: 5,
              source: "artificial-analysis",
              benchmark: "Preço de tabela do provedor",
              capturedAt: "2026-10-19T02:00:00.000Z",
              methodologyUrl: AA_METHODOLOGY,
            },
          ],
        },
        {
          id: "mimo-v2",
          name: "MiMo V2",
          creator: "Xiaomi",
          modality: "language",
          observations: [
            {
              metric: "intelligence-index",
              value: 41,
              source: "artificial-analysis",
              benchmark: "Artificial Analysis Intelligence Index",
              capturedAt: "2026-10-19T02:00:00.000Z",
              methodologyUrl: AA_METHODOLOGY,
            },
          ],
        },
      ],
      totalAvailable: 198,
      notes: [],
    },
    {
      modality: "text-to-image",
      group: "imagem",
      availableMetrics: ["arena-elo"],
      models: [
        {
          id: "gpt-image-2",
          name: "GPT Image 2",
          creator: "OpenAI",
          modality: "text-to-image",
          observations: [
            {
              metric: "arena-elo",
              value: 1243,
              source: "artificial-analysis",
              benchmark: "Text to Image Arena",
              confidence95: 8,
              capturedAt: "2026-10-19T02:00:00.000Z",
              methodologyUrl: AA_METHODOLOGY,
            },
          ],
        },
      ],
      totalAvailable: 148,
      notes: [],
    },
  ],
  coverage: [
    { modality: "language", metric: "intelligence-index", withData: 2, total: 2 },
    { modality: "language", metric: "price-input-1m", withData: 1, total: 2 },
    { modality: "text-to-image", metric: "arena-elo", withData: 1, total: 1 },
  ],
  changes: {
    since: "2026-10-12T11:00:00.000Z",
    comparable: true,
    entered: [{ id: "mimo-v2", name: "MiMo V2", creator: "Xiaomi" }],
    left: [],
    moved: [],
    leaders: [],
  },
};

function jsonResponse(data: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) } as Response);
}

function notFound(): Promise<Response> {
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
}

/** Serves the artifacts the dev server would, with `current` as today's edition. */
function serve(current: PulsoEdition = edition) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/editions/latest.json") return jsonResponse(current);
    if (url === `/editions/${current.calendarDate}/manha.json`) return jsonResponse(current);
    if (url === `/editions/${older.calendarDate}/manha.json`) return jsonResponse(older);
    if (url === "/editions/index.json") return jsonResponse(index);
    if (url === "/editions/models.json") return jsonResponse(catalog);
    return notFound();
  });
}

function renderAt(path: string, value: PreloadedEditionData | null = null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EditionDataProvider value={value}>
        <App />
      </EditionDataProvider>
    </MemoryRouter>
  );
}

function hrefOf(name: string | RegExp): string {
  return screen.getByRole("link", { name }).getAttribute("href") ?? "";
}

describe("Pulso reader", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    serve();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the cover with the masthead and links to each page at its served address", async () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Pulso" })).toBeInTheDocument();
    expect(screen.getByText("O que mudou em IA. Por que importa para o negócio.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pular para o conteúdo" })).toHaveAttribute("href", "#conteudo");
    expect(screen.getByRole("img", { name: "Professor Dorly" })).toHaveAttribute("src", "/brand/logo-tinta.png");
    expect(screen.getByRole("img", { name: "Professor Dorly" }).closest("a")).toHaveAttribute(
      "href",
      "https://dorly.com.br"
    );
    expect(hrefOf("artigos")).toBe("https://dorly.com.br/artigos/");
    expect(hrefOf("RSS")).toBe("/feed.xml");

    const nav = screen.getByRole("navigation", { name: "Seções" });
    const sections = Array.from(nav.querySelectorAll("a")).map((link) => [link.textContent, link.getAttribute("href")]);
    expect(sections).toEqual([
      ["Capa", "/"],
      ["Arquivo", "/arquivo/"],
      ["Modelos", "/modelos/"],
      ["Metodologia", "/metodologia/"],
    ]);
    // No in-site search and no theme switch: the site ships no script for them.
    expect(screen.queryByRole("link", { name: "Buscar" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Aparência" })).toBeNull();

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(edition.digest.headline);
    expect(hrefOf("Assinar via RSS")).toBe("/feed.xml");
    expect(hrefOf("Abrir edição completa")).toBe("/2026-10-19/");
    expect(hrefOf("Ver todas as edições")).toBe("/arquivo/");
    // The cover SVG is the social card (og:image); on the page it would repeat the headline.
    expect(document.querySelector('img[src$=".cover-r1.svg"]')).toBeNull();
  });

  it("names the edition above the headline by number and day, without a slot", async () => {
    renderAt("/");
    const heading = await screen.findByRole("heading", { level: 1 });
    const kicker = document.querySelector(".pulso-editionline");
    expect(kicker?.textContent).toContain("Pulso #101");
    expect(kicker?.textContent).toContain("19 de outubro de 2026");
    expect(kicker?.textContent).toContain("atualizado");
    expect(kicker?.textContent).not.toContain("Manhã");
    expect(heading).not.toHaveTextContent("#101");
    // The primary action is a button, not a bare coloured word (WCAG 1.4.1).
    expect(screen.getByRole("link", { name: "Abrir edição completa" })).toHaveClass("pulso-button");
  });

  it("lists earlier editions as a feed under the featured one", async () => {
    renderAt("/");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("heading", { level: 2, name: "Edições anteriores" })).toBeInTheDocument();
    expect(hrefOf(older.digest.headline)).toBe("/2026-10-18/");
    // The featured edition is rendered in full above; the feed does not repeat it.
    const entries = screen.getAllByRole("listitem");
    expect(entries.some((entry) => entry.textContent?.includes("Pulso #101"))).toBe(false);
  });

  it("opens an edition at its date, with a contents list that lands on real sections", async () => {
    renderAt("/2026-10-19/");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(edition.digest.headline);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/editions/2026-10-19/manha.json");

    const contents = screen.getAllByRole("navigation", { name: "Seções da edição" });
    expect(contents).toHaveLength(2);
    const targets = Array.from(contents[0]!.querySelectorAll("a")).map((link) => link.getAttribute("href"));
    expect(targets).toContain("#prioridades");
    for (const target of targets) {
      expect(document.getElementById(target!.slice(1))).not.toBeNull();
    }
    expect(screen.getByRole("heading", { level: 2, name: "Prioridades" })).toBeInTheDocument();
    expect(hrefOf("Edição anterior →")).toBe("/2026-10-18/");
    for (const link of screen.getAllByRole("link", { name: "Arquivo" })) {
      expect(link).toHaveAttribute("href", "/arquivo/");
    }
  });

  it("links an item straight to the original reporting and gives it an anchor to share", async () => {
    renderAt("/2026-10-19/");
    await screen.findByRole("heading", { level: 1 });

    const item = edition.items[0]!;
    // The digest bullet links to the same story, so pick the item's own headline link.
    const title = screen
      .getAllByRole("link", { name: item.title })
      .find((link) => link.classList.contains("pulso-story-title"))!;
    expect(title).toHaveAttribute("href", item.url);
    expect(title).toHaveAttribute("target", "_blank");
    expect(title).toHaveAttribute("rel", "noopener noreferrer");

    const anchor = itemAnchor(item);
    expect(anchor).toBe("n-0a1b2c3d4e");
    expect(title.closest("li")).toHaveAttribute("id", anchor);

    const share = decodeURIComponent(hrefOf("Compartilhar no WhatsApp"));
    expect(share).toContain("https://wa.me/?text=");
    expect(share).toContain(item.title);
    expect(share).toContain(item.url);
    expect(share).toContain(`${ORIGIN}/2026-10-19/#${anchor}`);

    // An item has no page of its own any more.
    const internal = Array.from(document.querySelectorAll("a[href]")).map((link) => link.getAttribute("href") ?? "");
    expect(internal.some((href) => href.includes("/noticia/"))).toBe(false);
  });

  it("opens the summary in place: expanded for priorities, collapsed in the radar", async () => {
    const paragraphs =
      "A empresa apresentou o modelo nesta segunda-feira, com foco em uso corporativo.\n\nO anúncio detalha limites de contexto e disponibilidade por região.";
    const withSummaries: PulsoEdition = {
      ...edition,
      items: [
        { ...edition.items[0]!, summaryPt: paragraphs },
        {
          ...edition.items[0]!,
          id: "radar-item-000000000",
          title: "Radar story",
          url: "https://example.com/radar",
          summaryPt: "O radar também tem resumo.",
        },
      ],
    };
    serve(withSummaries);
    renderAt("/2026-10-19/");
    await screen.findByRole("heading", { level: 1 });

    const summaries = Array.from(document.querySelectorAll("details.pulso-story-summary"));
    expect(summaries).toHaveLength(2);
    const [featured, radar] = summaries as HTMLDetailsElement[];
    // Every paragraph is on the page: there is no item page to hold the rest.
    expect(featured).toHaveTextContent("uso corporativo");
    expect(featured).toHaveTextContent("disponibilidade por região");
    expect(featured!.open).toBe(true);
    expect(radar).toHaveTextContent("O radar também tem resumo.");
    expect(radar!.open).toBe(false);
    // The one-line blurb stays visible above the summary.
    expect(screen.getAllByText("Guia prático em português.").length).toBeGreaterThan(0);
  });

  it("groups labs separately from press, including Brazilian outlets covering the world", async () => {
    const mixed: PulsoEdition = {
      ...edition,
      digest: { ...edition.digest, bullets: [] },
      items: [
        { ...edition.items[0]!, id: "br-press-0000000000", outlet: "Olhar Digital", title: "Musk quer tirar a IA da Terra", url: "https://olhardigital.com.br/musk-ia" },
        { ...edition.items[0]!, id: "us-lab-00000000000", region: "us", kind: "lab", outlet: "OpenAI News", title: "Codex at loveholidays", url: "https://openai.com/news/codex" },
        { ...edition.items[0]!, id: "us-press-000000000", region: "us", outlet: "TechCrunch — AI", title: "OpenAI loses another executive", url: "https://techcrunch.com/openai-exec" },
      ],
    };
    serve(mixed);
    renderAt("/2026-10-19/");
    await screen.findByRole("heading", { level: 1 });

    const press = screen.getByRole("heading", { level: 2, name: "Radar · Imprensa" }).closest("section");
    expect(press).toHaveTextContent("Olhar Digital");
    expect(press).toHaveTextContent("Brasil");
    expect(press).toHaveTextContent("TechCrunch — AI");
    expect(press).not.toHaveTextContent("OpenAI News");

    const labs = screen.getByRole("heading", { level: 2, name: "Radar · Direto dos labs" }).closest("section");
    expect(labs).toHaveTextContent("OpenAI News");
    expect(labs).not.toHaveTextContent("Olhar Digital");
  });

  it("shares the edition with plain links that work without a script", async () => {
    renderAt("/2026-10-19/");
    await screen.findByRole("heading", { level: 1 });

    const whatsapp = decodeURIComponent(hrefOf("WhatsApp"));
    expect(whatsapp).toContain("https://wa.me/?text=");
    expect(whatsapp).toContain(edition.digest.headline);
    expect(whatsapp).toContain(`${ORIGIN}/2026-10-19/`);

    expect(decodeURIComponent(hrefOf("LinkedIn"))).toBe(
      `https://www.linkedin.com/sharing/share-offsite/?url=${ORIGIN}/2026-10-19/`
    );
    expect(screen.queryByRole("button", { name: "Compartilhar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copiar texto" })).toBeNull();
  });

  it("shows the item headline in Portuguese and links to the original", async () => {
    serve({
      ...edition,
      items: [
        {
          ...edition.items[0]!,
          title: "What changes for people using GPT-5.6 at work",
          titlePt: "O que muda para quem usa o GPT-5.6 no trabalho",
        },
      ],
    });
    renderAt("/2026-10-19/");
    await screen.findByRole("heading", { level: 1 });
    expect(hrefOf("O que muda para quem usa o GPT-5.6 no trabalho")).toBe(edition.items[0]!.url);
    expect(screen.queryByText("What changes for people using GPT-5.6 at work")).toBeNull();
  });

  it("labels an opinion column instead of passing it off as reporting", async () => {
    serve({
      ...edition,
      items: [{ ...edition.items[0]!, title: "OPINIÃO: O jurídico não precisa só de IA", genre: "opinion" }],
    });
    renderAt("/2026-10-19/");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("Opinião")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /OPINIÃO: O jurídico não precisa só de IA/ })).toBeInTheDocument();
  });

  it("explains why a quiet edition has no items instead of rendering an empty cover", async () => {
    serve({
      ...edition,
      kind: "quiet",
      items: [],
      digest: {
        headline: "Sem novidade verificada nesta edição",
        lede: "Nada entrou porque nada foi confirmado na fonte.",
        bullets: [],
      },
      gate: {
        checked: 4,
        bulletsDropped: 2,
        blurbsDropped: 1,
        headlineFellBack: false,
        unsupportedSamples: ["currency:US$ 99,90"],
      },
    });
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Sem novidade verificada nesta edição");
    const notice = screen.getByRole("region", { name: "Por que esta capa está vazia" });
    expect(notice).toHaveTextContent("3 afirmações foram descartadas");
  });

  it("lists the archive by number at each edition's served address", async () => {
    renderAt("/arquivo/");
    expect(await screen.findByRole("heading", { level: 1, name: "Arquivo" })).toBeInTheDocument();
    const entries = screen.getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("Pulso #101");
    expect(entries[1]).toHaveTextContent("Pulso #100");
    expect(hrefOf(edition.digest.headline)).toBe("/2026-10-19/");
  });

  it("renders a preloaded edition without fetching it again", async () => {
    renderAt("/2026-10-19/", { edition, index });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(edition.digest.headline);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("resolves every artifact fetch under /editions/", async () => {
    renderAt("/");
    await screen.findByRole("heading", { level: 1 });
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith("/editions/"))).toBe(true);
  });

  it("shows the models table with provenance and never renders a missing number as zero", async () => {
    renderAt("/modelos/");
    expect(await screen.findByRole("heading", { level: 1, name: "Modelos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Texto e multimodal" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Imagem" })).toBeInTheDocument();
    expect(await screen.findByRole("row", { name: /Claude Opus 5/ })).toBeInTheDocument();
    // Elo carries its 95% interval, so a reader can see when a gap is not conclusive.
    expect(screen.getByText("1243 ± 8")).toBeInTheDocument();
    // MiMo has no published price: an em dash, never "0.00" at the top of a cheapest list.
    const row = screen.getByRole("row", { name: /MiMo V2/ });
    expect(row).toHaveTextContent("—");
    expect(row).not.toHaveTextContent("0.00");
    expect(screen.getByText(/1 de 2 modelos têm esse dado publicado/)).toBeInTheDocument();
    expect(screen.getByText(/A fonte mediu 198 modelos/)).toBeInTheDocument();
    // The free API's terms: credit with a link, wherever the numbers are shown.
    expect(screen.getByRole("link", { name: "Artificial Analysis" })).toHaveAttribute("href", "https://artificialanalysis.ai/");
    // Ready answers and a chart, rendered without any script.
    expect(screen.getByRole("heading", { level: 3, name: "Mais inteligente" })).toBeInTheDocument();
    expect(screen.getByText(/Inteligência: os 2 maiores/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /O que mudou desde/ })).toBeInTheDocument();
    expect(screen.getByText(/Entraram na lista:/).parentElement).toHaveTextContent("MiMo V2");
  });

  it("explains the method without needing any artifact", async () => {
    renderAt("/metodologia/");
    expect(await screen.findByRole("heading", { level: 1, name: "Metodologia" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "O que não é verificado" })).toBeInTheDocument();
    expect(screen.getByText(/não promete acurácia absoluta/)).toBeInTheDocument();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("routes", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    serve();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders a noindex 404 for an unknown route", async () => {
    renderAt("/rota/que/nao/existe");
    expect(await screen.findByRole("heading", { level: 1, name: "Página não encontrada" })).toBeInTheDocument();
    expect(document.querySelector('meta[name="robots"][content="noindex"]')).not.toBeNull();
  });

  it("treats a one-segment path that is not a daily date as a plain 404, without fetching", async () => {
    for (const path of ["/ontem", "/2026-10-9", "/2026-10-08"]) {
      const view = renderAt(path);
      expect(await screen.findByRole("heading", { level: 1, name: "Página não encontrada" })).toBeInTheDocument();
      view.unmount();
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("answers a valid date with no edition as a missing edition", async () => {
    renderAt("/2026-10-11/");
    expect(await screen.findByRole("heading", { level: 1, name: "Edição não encontrada" })).toBeInTheDocument();
  });

  it("no longer serves item, topic, search or status pages", async () => {
    for (const path of ["/2026-10-19/noticia/abc", "/topico/regulacao", "/busca", "/status"]) {
      const view = renderAt(path);
      expect(await screen.findByRole("heading", { level: 1, name: "Página não encontrada" })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("keeps the static routes ahead of the date route", async () => {
    for (const [path, heading] of [
      ["/arquivo/", "Arquivo"],
      ["/modelos/", "Modelos"],
      ["/metodologia/", "Metodologia"],
      ["/semana/2026-W41", "Episódio não encontrado"],
    ] as const) {
      const view = renderAt(path);
      const h1 = await screen.findByRole("heading", { level: 1 }, { timeout: 5_000 });
      expect(h1).toHaveTextContent(heading);
      view.unmount();
    }
  });
});
