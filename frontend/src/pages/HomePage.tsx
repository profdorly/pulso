import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { fetchEditionIndex, fetchLatestEdition } from "../lib/editionsApi.js";
import { usePreloadedEditionData, useEditionResource } from "../lib/editionData.js";
import type { PulsoEdition, PulsoIndex } from "../lib/edition.js";
import { editionPath } from "../lib/editionPaths.js";
import { pageRoute } from "../lib/paths.js";
import { DigestBullets } from "../components/pulso/DigestBullets.js";
import { EditionEntry } from "../components/pulso/EditionEntry.js";
import { EditionKicker } from "../components/pulso/EditionKicker.js";
import { ModelsStrip } from "../components/pulso/ModelsStrip.js";
import { QuietNotice } from "../components/pulso/QuietNotice.js";
import { SubscribeCta } from "../components/pulso/SubscribeCta.js";
import { EditionNotes } from "../components/pulso/EditionNotes.js";
import { useIsClient } from "../lib/useIsClient.js";

/** Client-only and lazy: a week without an episode leaves no trace on the cover. */
const Weekly = lazy(() => import("./Weekly.js"));

/** Earlier editions shown before the reader moves into the complete archive. */
const FEED_LENGTH = 8;

export function HomePage() {
  const preloaded = usePreloadedEditionData();
  const isClient = useIsClient();
  const editionResource = useEditionResource<PulsoEdition>(
    preloaded?.edition ?? null,
    fetchLatestEdition,
    []
  );
  const indexResource = useEditionResource<PulsoIndex>(
    preloaded?.index ?? null,
    fetchEditionIndex,
    []
  );

  const error = editionResource.error ?? indexResource.error;
  const edition = editionResource.data;
  const index = indexResource.data;

  if (error) return <p className="text-base text-muted" role="alert">{error}</p>;
  if (!edition || !index) return <p className="text-base text-muted" role="status">Carregando a capa…</p>;

  const earlier = index.editions.filter((entry) => entry.id !== edition.id).slice(0, FEED_LENGTH);

  /*
   * The cover SVG is not rendered here. It is the social card: it sets the headline in a dark
   * frame for WhatsApp and LinkedIn, and on the page it repeated the headline directly above
   * the headline, pushing the actual news below the fold. It still ships as og:image.
   */
  return (
    <div className="pulso-page">
      <div className="pulso-split">
        <section aria-labelledby="capa-titulo">
          <div>
            <EditionKicker edition={edition} />
          </div>
          <h1 id="capa-titulo" className="pulso-display mt-5">
            {edition.digest.headline}
          </h1>
          <p className="pulso-lede mt-6">{edition.digest.lede}</p>
          <p className="mt-8">
            <Link to={pageRoute(editionPath(edition.calendarDate, edition.slot))} className="pulso-button pulso-button--go">
              Abrir edição completa
            </Link>
          </p>
          {edition.digest.bullets.length > 0 ? (
            <div className="mt-14 border-t border-border-strong pt-8">
              <DigestBullets bullets={edition.digest.bullets} title="Nesta edição" />
            </div>
          ) : null}
          <div className="mt-10">
            <QuietNotice edition={edition} />
          </div>
        </section>

        <aside className="pulso-aside">
          <ModelsStrip edition={edition} />
        </aside>
      </div>

      {isClient ? (
        <Suspense fallback={null}>
          <Weekly view="card" />
        </Suspense>
      ) : null}

      {earlier.length > 0 ? (
        <section aria-labelledby="anteriores">
          <div className="pulso-section-head">
            <h2 id="anteriores" className="pulso-section-title">
              Edições anteriores
            </h2>
            <Link to="/arquivo/" className="pulso-action">
              Ver todas as edições
            </Link>
          </div>
          <ul className="pulso-editorial-list">
            {earlier.map((entry) => (
              <EditionEntry key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      ) : null}

      <SubscribeCta />
      {edition.sourceFailures.length > 0 ? <EditionNotes failures={edition.sourceFailures} /> : null}
    </div>
  );
}
