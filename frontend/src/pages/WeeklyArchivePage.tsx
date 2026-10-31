import { Link } from "react-router-dom";
import { useEditionResource, usePreloadedEditionData } from "../lib/editionData.js";
import { pageRoute } from "../lib/paths.js";
import { fetchWeeklyIndex, formatMinutes, formatWeekRange, type WeeklyIndex } from "../lib/weekly.js";

const EMPTY: WeeklyIndex = { schemaVersion: 1, latestId: null, episodes: [] };

/**
 * `/semana/`: every Pulso da Semana episode, newest first.
 *
 * Static like the archive: the prerender seeds the index, so the list is in the served HTML and
 * the page ships no script. The player stays on each episode's own page.
 */
export function WeeklyArchivePage() {
  const preloaded = usePreloadedEditionData();
  const { data, error } = useEditionResource<WeeklyIndex>(
    preloaded?.weeklyIndex ?? null,
    async () => (await fetchWeeklyIndex()) ?? EMPTY,
    []
  );

  if (error) return <p className="text-base text-muted">{error}</p>;
  if (!data) return <p className="text-base text-muted">Carregando os episódios…</p>;

  const episodes = data.episodes;
  return (
    <section className="pulso-page">
      <header className="pulso-page-header">
        <p className="pulso-kicker">Em áudio, toda segunda-feira</p>
        <h1 className="pulso-title">Pulso da Semana</h1>
        <p className="pulso-lede mt-4">
          A semana em IA em até cinco minutos, numa conversa entre duas vozes sintéticas feita a partir das edições do
          Pulso. Cada episódio traz a transcrição e as matérias citadas.
        </p>
        <p className="pulso-note mt-4">
          {episodes.length === 0
            ? "O primeiro episódio ainda não saiu."
            : `${episodes.length} ${episodes.length === 1 ? "episódio" : "episódios"}`}
        </p>
      </header>

      {episodes.length > 0 ? (
        <ul className="pulso-editorial-list">
          {episodes.map((episode) => (
            <li key={episode.weekId} className="pulso-entry">
              {/* The index only guarantees weekId and path; the rest is shown when present. */}
              <p className="pulso-entry-meta">
                {episode.from && episode.to ? <span>{formatWeekRange(episode.from, episode.to)}</span> : null}
                {typeof episode.durationSeconds === "number" ? <span>{formatMinutes(episode.durationSeconds)}</span> : null}
              </p>
              <div className="flex flex-col gap-3">
                <Link to={pageRoute(`/semana/${episode.weekId}`)} className="pulso-entry-title">
                  {episode.title || `Semana ${episode.weekId}`}
                </Link>
                {episode.description ? <p className="pulso-note">{episode.description}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
