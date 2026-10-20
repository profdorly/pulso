import { Link, useParams } from "react-router-dom";
import { fetchEditionIndex } from "../lib/editionsApi.js";
import { usePreloadedEditionData, useEditionResource } from "../lib/editionData.js";
import type { PulsoIndex } from "../lib/edition.js";
import { EditionEntry } from "../components/pulso/EditionEntry.js";
import {
  ARCHIVE_PAGE_SIZE,
  archivePageRoute,
  normalizePage,
  pageCount,
  sliceForPage,
} from "../lib/archivePaging.js";

export function ArchivePage() {
  const preloaded = usePreloadedEditionData();
  const params = useParams<{ page?: string }>();
  const { data: index, error } = useEditionResource<PulsoIndex>(
    preloaded?.index ?? null,
    fetchEditionIndex,
    []
  );

  if (error) return <p className="text-base text-muted">{error}</p>;
  if (!index) return <p className="text-base text-muted">Carregando o arquivo…</p>;

  // The whole index is in hand, so a page is a slice; each page is also a prerendered document.
  const total = index.editions.length;
  const totalPages = pageCount(total, ARCHIVE_PAGE_SIZE);
  const page = normalizePage(params.page, total, ARCHIVE_PAGE_SIZE);
  const entries = sliceForPage(index.editions, page, ARCHIVE_PAGE_SIZE);

  return (
    <section className="pulso-page">
      <header className="pulso-page-header">
        <h1 className="pulso-title">Arquivo</h1>
        <p className="pulso-note mt-4">
          {total} {total === 1 ? "edição publicada" : "edições publicadas"}
          {totalPages > 1 ? `, página ${page} de ${totalPages}` : ""}
        </p>
      </header>

      <ul className="pulso-editorial-list">
        {entries.map((entry) => (
          <EditionEntry key={entry.id} entry={entry} withTime />
        ))}
      </ul>

      {totalPages > 1 ? (
        <nav className="pulso-pager" aria-label="Paginação do arquivo">
          {page > 1 ? (
            <Link to={archivePageRoute(page - 1)} className="pulso-action" rel="prev">
              ← Edições mais recentes
            </Link>
          ) : (
            <span />
          )}
          {page < totalPages ? (
            <Link to={archivePageRoute(page + 1)} className="pulso-action" rel="next">
              Edições anteriores →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}
