import { Link, useParams } from "react-router-dom";
import { fetchEdition, fetchEditionIndex } from "../lib/editionsApi.js";
import {
  preloadedEditionFor,
  usePreloadedEditionData,
  useEditionResource,
} from "../lib/editionData.js";
import type { PulsoEdition, PulsoIndex } from "../lib/edition.js";
import { editionPath } from "../lib/editionPaths.js";
import { pageRoute } from "../lib/paths.js";
import { neighboringEditions, partitionItems, SECTION_TITLE } from "../lib/sections.js";
import { splitByPriority } from "../lib/priority.js";
import { CompactItems } from "../components/pulso/CompactItems.js";
import { CorrectionLink } from "../components/pulso/CorrectionLink.js";
import { DigestBullets } from "../components/pulso/DigestBullets.js";
import { EditionContents, type ContentsEntry } from "../components/pulso/EditionContents.js";
import { EditionKicker } from "../components/pulso/EditionKicker.js";
import { EditionNotes } from "../components/pulso/EditionNotes.js";
import { EditionShare } from "../components/pulso/EditionShare.js";
import { ModelsStrip } from "../components/pulso/ModelsStrip.js";
import { QuietNotice } from "../components/pulso/QuietNotice.js";
import { SubscribeCta } from "../components/pulso/SubscribeCta.js";
import { NotFoundPage } from "./NotFoundPage.js";

/** One edition a day, published as `manha` and addressed by its date (`/2026-10-09/`). */
const DAILY_SLOT = "manha";

export function EditionPage() {
  const { date } = useParams();
  const preloaded = usePreloadedEditionData();

  const matchedEdition = preloadedEditionFor(preloaded, date, DAILY_SLOT);
  const editionResource = useEditionResource<PulsoEdition>(
    matchedEdition,
    () => fetchEdition(date ?? "", DAILY_SLOT),
    [date],
    !matchedEdition && preloaded?.notFound === true
  );
  const indexResource = useEditionResource<PulsoIndex>(preloaded?.index ?? null, fetchEditionIndex, []);

  const edition = editionResource.data;
  const index = indexResource.data;
  const error = editionResource.error ?? indexResource.error;

  if (!date || editionResource.notFound) {
    return (
      <NotFoundPage
        title="Edição não encontrada"
        message="Não existe edição publicada nesse endereço. Confira o arquivo para ver as edições disponíveis."
      />
    );
  }
  if (error) return <p className="text-base text-muted" role="alert">{error}</p>;
  if (!edition || !index) return <p className="text-base text-muted" role="status">Carregando a edição…</p>;

  const { featured, radar } = splitByPriority(edition);
  const radarSections = partitionItems(radar);
  const neighbors = neighboringEditions(index, edition.id);
  // Only sections that render: CompactItems returns nothing for an empty list.
  const contents: ContentsEntry[] = [
    { id: "em-resumo", label: "Em resumo", count: edition.digest.bullets.length },
    { id: "prioridades", label: SECTION_TITLE.featured, count: featured.length },
    { id: "radar-imprensa", label: `${SECTION_TITLE.radar} · ${SECTION_TITLE.press}`, count: radarSections.press.length },
    { id: "radar-labs", label: `${SECTION_TITLE.radar} · ${SECTION_TITLE.labs}`, count: radarSections.labs.length },
  ].filter((entry) => entry.count > 0);

  // The cover SVG is the social card; on the page it would only repeat the headline.
  return (
    <article className="pulso-page">
      <header className="pulso-page-header flex flex-col gap-6">
        <p className="pulso-meta">
          <Link to="/" className="pulso-link">Capa</Link>
          {" / "}
          <Link to="/arquivo/" className="pulso-link">Arquivo</Link>
        </p>
        <EditionKicker edition={edition} />
        <h1 className="pulso-title">{edition.digest.headline}</h1>
        <p className="pulso-lede">{edition.digest.lede}</p>
        <EditionShare edition={edition} />
      </header>

      <div className="pulso-split">
        <div className="flex min-w-0 flex-col gap-16">
          <EditionContents entries={contents} placement="inline" />
          <DigestBullets bullets={edition.digest.bullets} title="Em resumo" />
          <QuietNotice edition={edition} />
          <CompactItems id="prioridades" title={SECTION_TITLE.featured} items={featured} edition={edition} detailed />
          <CompactItems
            id="radar-imprensa"
            title={`${SECTION_TITLE.radar} · ${SECTION_TITLE.press}`}
            items={radarSections.press}
            edition={edition}
          />
          <CompactItems
            id="radar-labs"
            title={`${SECTION_TITLE.radar} · ${SECTION_TITLE.labs}`}
            items={radarSections.labs}
            edition={edition}
          />
        </div>
        <aside className="pulso-aside">
          <EditionContents entries={contents} placement="aside" />
          <ModelsStrip edition={edition} />
        </aside>
      </div>

      <nav className="pulso-pager" aria-label="Edições vizinhas">
        {neighbors.newer ? (
          <Link to={pageRoute(editionPath(neighbors.newer.calendarDate, neighbors.newer.slot))} className="pulso-action">
            ← Edição mais recente
          </Link>
        ) : (
          <span />
        )}
        {neighbors.older ? (
          <Link to={pageRoute(editionPath(neighbors.older.calendarDate, neighbors.older.slot))} className="pulso-action">
            Edição anterior →
          </Link>
        ) : null}
      </nav>

      <SubscribeCta />
      <div className="flex flex-col gap-3">
        <EditionNotes failures={edition.sourceFailures} />
        <CorrectionLink edition={edition} />
      </div>
    </article>
  );
}
