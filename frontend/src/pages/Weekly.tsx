import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { trackEvent } from "../lib/analytics.js";
import { PUBLISHER_NAME } from "../lib/siteBase.js";
import { EditionNotFoundError } from "../lib/editionsApi.js";
import {
  episodeAudioUrl,
  fetchEpisode,
  fetchWeeklyIndex,
  formatClock,
  formatMinutes,
  formatWeekRange,
  indexAt,
  sourceRoute,
  type WeeklyEpisode,
  type WeeklyIndex,
  type WeeklySource,
} from "../lib/weekly.js";
import "../components/pulso/weekly.css";

/*
 * Everything the weekly audio needs on screen, in one lazily loaded module: the cover card and
 * the episode page, with their CSS in the same chunk.
 */

const RATES = [1, 1.25, 1.5, 0.85];
const SKIP_SECONDS = 15;

/**
 * One weekly episode: the player, the chapters, and a transcript that follows the voice.
 *
 * Follow-along is driven by the word timings ElevenLabs returned with the audio, not by an
 * estimate. The active turn is React state (it changes a few times a minute); the active word is
 * written straight to the DOM on each animation frame, because re-rendering a thousand spans
 * sixty times a second to move one highlight would cost more than the audio itself.
 *
 * Clicking a word plays from that word; the timestamp beside each turn is the keyboard path to
 * the same thing. Scrolling by hand while it plays stops the page from pulling you back, and a
 * button offers to resume.
 */
export function WeeklyEpisodePage() {
  const { weekId = "" } = useParams();
  // Keyed by week so a route change shows the loading state without resetting state in the effect.
  const [loaded, setLoaded] = useState<{ weekId: string; episode?: WeeklyEpisode; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchEpisode(weekId)
      .then((episode) => alive && setLoaded({ weekId, episode }))
      .catch((err: unknown) => {
        if (!alive) return;
        const error = err instanceof EditionNotFoundError ? "missing" : err instanceof Error ? err.message : String(err);
        setLoaded({ weekId, error });
      });
    return () => {
      alive = false;
    };
  }, [weekId]);

  const current = loaded?.weekId === weekId ? loaded : null;
  const episode = current?.episode ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    if (episode) document.title = `${episode.title} — Pulso da Semana`;
  }, [episode]);

  if (error === "missing") {
    // Inline rather than <NotFoundPage>: importing that page here made the bundler split React's
    // runtime out of the entry chunk (+1 kB on the critical path) for one rarely seen message.
    return (
      <section className="pulso-page-header flex flex-col gap-5">
        <p className="pulso-kicker">Erro 404</p>
        <h1 className="pulso-title">Episódio não encontrado</h1>
        <p className="pulso-lede">Não há episódio do Pulso da Semana neste endereço.</p>
        <p>
          <Link to="/" className="pulso-button pulso-button--go">
            Ir para a capa
          </Link>
        </p>
      </section>
    );
  }
  if (error) return <p className="text-base text-muted" role="alert">{error}</p>;
  if (!episode) return <p className="text-base text-muted" role="status">Carregando o episódio…</p>;
  return <Episode episode={episode} />;
}

function Episode({ episode }: { episode: WeeklyEpisode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const turnRefs = useRef<Array<HTMLDivElement | null>>([]);
  const activeRef = useRef(-1);
  const wordRef = useRef(-1);
  const followRef = useRef(true);
  const startedRef = useRef(false);

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(episode.durationSeconds);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [active, setActive] = useState(-1);
  const [follow, setFollow] = useState(true);

  const turnStarts = useMemo(() => episode.turns.map((turn) => turn.start), [episode]);
  const chapterStarts = useMemo(() => episode.chapters.map((chapter) => chapter.start), [episode]);
  const sources = useMemo(() => new Map(episode.sources.map((source) => [source.ref, source])), [episode]);
  const chapterAtTurn = useMemo(() => {
    const firsts = new Map<number, (typeof episode.chapters)[number]>();
    for (const chapter of episode.chapters) {
      const index = episode.turns.findIndex((turn) => turn.start >= chapter.start);
      if (index >= 0) firsts.set(index, chapter);
    }
    return firsts;
  }, [episode]);

  /** Paints the current word inside the active turn; cheap enough to run every frame. */
  const paintWords = useCallback(
    (t: number, turnIndex: number) => {
      const el = turnRefs.current[turnIndex];
      const turn = episode.turns[turnIndex];
      if (!el || !turn) return;
      const spans = el.querySelectorAll<HTMLElement>("[data-w]");
      const word = indexAt(turn.words.map((pair) => pair[0]), t);
      const last = wordRef.current;
      if (word === last) return;
      // Forward: only the words between the last mark and now change. Backward (a seek): repaint.
      const from = word > last ? Math.max(0, last) : 0;
      const to = word > last ? word : spans.length - 1;
      for (let k = from; k <= to && k < spans.length; k += 1) {
        spans[k]!.dataset.s = k < word ? "p" : k === word ? "c" : "";
      }
      wordRef.current = word;
    },
    [episode]
  );

  const sync = useCallback(
    (t: number) => {
      const index = indexAt(turnStarts, t);
      if (index !== activeRef.current) {
        // Leaving a turn clears its word marks, so it reads as plain text again.
        const previous = turnRefs.current[activeRef.current];
        previous?.querySelectorAll<HTMLElement>("[data-w]").forEach((span) => (span.dataset.s = ""));
        activeRef.current = index;
        wordRef.current = -1;
        setActive(index);
        if (followRef.current && index >= 0) {
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          turnRefs.current[index]?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        }
      }
      if (index >= 0) paintWords(t, index);
    },
    [paintWords, turnStarts]
  );

  // Frame loop only while playing; paused, the page is static and costs nothing.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) sync(audio.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, sync]);

  // A hand on the scroll wheel means the reader wants to look elsewhere.
  useEffect(() => {
    if (!playing) return;
    const stop = () => {
      if (followRef.current) {
        followRef.current = false;
        setFollow(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)) stop();
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", onKey);
    };
  }, [playing]);

  const resumeFollow = () => {
    followRef.current = true;
    setFollow(true);
    if (activeRef.current >= 0) turnRefs.current[activeRef.current]?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const seek = (t: number, autoplay = true) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(t, duration));
    setTime(audio.currentTime);
    sync(audio.currentTime);
    if (autoplay && audio.paused) void audio.play();
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
    if (audioRef.current) audioRef.current.playbackRate = next;
    setRate(next);
  };

  const onTextClick = (event: MouseEvent<HTMLParagraphElement>, turnIndex: number) => {
    const turn = episode.turns[turnIndex];
    if (!turn) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-w]");
    const word = target ? Number(target.dataset.w) : -1;
    seek(word >= 0 ? (turn.words[word]?.[0] ?? turn.start) : turn.start);
  };

  const docked = playing || time > 0;
  const chapterIndex = Math.max(0, indexAt(chapterStarts, time));
  const currentChapter = episode.chapters[chapterIndex];
  const range = formatWeekRange(episode.from, episode.to);

  return (
    <article className={`pulso-page pulso-weekly${docked ? " is-docked" : ""}`}>
      <header className="pulso-page-header flex flex-col gap-5">
        <p className="pulso-meta">
          <Link to="/" className="pulso-link">Capa</Link>
          {" / "}
          <Link to="/arquivo" className="pulso-link">Arquivo</Link>
        </p>
        <p className="pulso-editionline">
          <span className="pulso-edition-number">Pulso da Semana</span>
          <span>{range}</span>
          <span>{formatMinutes(episode.durationSeconds)}</span>
        </p>
        <h1 className="pulso-title">{episode.title}</h1>
        <p className="pulso-lede">{episode.description}</p>
        <p className="pulso-note pulso-weekly-disclosure">
          Conversa entre duas vozes sintéticas, criadas pelo {PUBLISHER_NAME} com inteligência artificial. O roteiro foi
          escrito a partir de{" "}
          {episode.sources.length} matérias publicadas no Pulso nesta semana e checado contra elas antes da gravação.
        </p>
      </header>

      <div className="pulso-weekly-body">
        {/* The slot keeps the player's height in the flow; once listening starts the player docks
            to the bottom of the screen so it stays in reach while the transcript scrolls. */}
        <div className="pulso-player-slot">
          <section className="pulso-player" aria-label="Player do episódio">
            {/* No caption track: the full, synchronised transcript is on this page. */}
            <audio
              ref={audioRef}
              src={episodeAudioUrl(episode)}
              preload="metadata"
              onPlay={() => {
                setPlaying(true);
                if (!startedRef.current) {
                  startedRef.current = true;
                  trackEvent("weekly_play", { week_id: episode.weekId });
                }
              }}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              onSeeked={(event) => sync(event.currentTarget.currentTime)}
              onLoadedMetadata={(event) => Number.isFinite(event.currentTarget.duration) && setDuration(event.currentTarget.duration)}
            />
            <button
              type="button"
              className="pulso-player-play"
              onClick={toggle}
              aria-label={playing ? "Pausar" : time > 0 ? "Continuar" : "Ouvir o episódio"}
            >
              <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
            </button>
            <div className="pulso-player-main">
              <p className="pulso-player-now">
                <span className="pulso-player-chapter">{currentChapter?.title ?? episode.title}</span>
                <span className="pulso-player-clock">
                  {formatClock(time)} / {formatClock(duration)}
                </span>
              </p>
              <input
                type="range"
                className="pulso-player-range"
                min={0}
                max={Math.ceil(duration)}
                step={1}
                value={Math.floor(time)}
                onChange={(event) => seek(Number(event.target.value), false)}
                aria-label="Posição no episódio"
                aria-valuetext={`${formatClock(time)} de ${formatClock(duration)}`}
                style={{ ["--progress" as string]: `${duration ? (time / duration) * 100 : 0}%` }}
              />
            </div>
            <div className="pulso-player-tools">
              <button type="button" className="pulso-player-tool" onClick={() => seek(time - SKIP_SECONDS, false)} aria-label="Voltar 15 segundos">
                −15
              </button>
              <button type="button" className="pulso-player-tool" onClick={() => seek(time + SKIP_SECONDS, false)} aria-label="Avançar 15 segundos">
                +15
              </button>
              <button type="button" className="pulso-player-tool" onClick={cycleRate} aria-label={`Velocidade ${rate}x; mudar`}>
                {rate}×
              </button>
            </div>
          </section>
        </div>

        <div className="pulso-split">
          <section aria-labelledby="transcricao" className="min-w-0">
            <div className="pulso-section-head">
              <h2 id="transcricao" className="pulso-section-title">
                Transcrição
              </h2>
              <p className="pulso-note">Toque numa frase para ouvir a partir dela.</p>
            </div>

            <div className="pulso-transcript">
              {episode.turns.map((turn, index) => {
                const chapter = chapterAtTurn.get(index);
                const role = episode.speakers[turn.speaker].role;
                const words = turn.text.split(" ");
                const cited = turn.refs.map((ref) => sources.get(ref)).filter((s): s is WeeklySource => Boolean(s));
                return (
                  <div key={turn.id} className="pulso-turn-group">
                    {chapter ? (
                      <h3 id={`capitulo-${chapter.id}`} className="pulso-transcript-chapter">
                        <span className="pulso-meta">{formatClock(chapter.start)}</span>
                        {chapter.title}
                      </h3>
                    ) : null}
                    <div
                      ref={(el) => {
                        turnRefs.current[index] = el;
                      }}
                      className="pulso-turn"
                      data-speaker={turn.speaker}
                      data-active={index === active ? "true" : undefined}
                    >
                      <div className="pulso-turn-head">
                        <span className="pulso-turn-who">{role}</span>
                        <button
                          type="button"
                          className="pulso-turn-time"
                          onClick={() => seek(turn.start)}
                          aria-label={`Ouvir a partir de ${formatClock(turn.start)}, fala de ${role.toLowerCase()}`}
                        >
                          {formatClock(turn.start)}
                        </button>
                      </div>
                      {/* Pointer enhancement; the timestamp button above is the keyboard path. */}
                      <p className="pulso-turn-text" onClick={(event) => onTextClick(event, index)}>
                        {words.map((word, k) => (
                          <span key={k} data-w={k}>
                            {word}
                            {k < words.length - 1 ? " " : ""}
                          </span>
                        ))}
                      </p>
                      {cited.length > 0 ? (
                        <p className="pulso-turn-refs">
                          {cited.map((source) => (
                            <Link key={source.ref} to={sourceRoute(source)} className="pulso-chip" title={source.title}>
                              {source.outlet}
                            </Link>
                          ))}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="pulso-aside">
            <nav className="pulso-panel pulso-chapters" aria-labelledby="capitulos">
              <h2 id="capitulos" className="pulso-models-title">
                Capítulos
              </h2>
              <ol>
                {episode.chapters.map((chapter, index) => (
                  <li key={chapter.id}>
                    <button
                      type="button"
                      onClick={() => seek(chapter.start)}
                      aria-current={index === chapterIndex && time > 0 ? "true" : undefined}
                    >
                      <span className="pulso-chapters-time">{formatClock(chapter.start)}</span>
                      <span>{chapter.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="pulso-chapters-thesis">
                <p className="pulso-kicker">O fio da semana</p>
                <p>{episode.thesis}</p>
              </div>
            </nav>
          </aside>
        </div>
      </div>

      <section aria-labelledby="citadas">
        <div className="pulso-section-head">
          <h2 id="citadas" className="pulso-section-title">
            Matérias citadas
          </h2>
          <p className="pulso-note">{episode.sources.length} matérias, na ordem em que aparecem</p>
        </div>
        <ol className="pulso-editorial-list">
          {episode.sources.map((source) => (
            <li key={source.ref} className="pulso-entry">
              <p className="pulso-entry-meta">
                <span>{source.outlet}</span>
              </p>
              <div className="flex flex-col gap-3">
                <Link to={sourceRoute(source)} className="pulso-entry-title">
                  {source.title}
                </Link>
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="pulso-action pulso-action--muted">
                  Abrir no {source.outlet}
                </a>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {playing && !follow ? (
        <button type="button" className="pulso-pill pulso-pill--solid pulso-follow" onClick={resumeFollow}>
          Voltar para a fala atual
        </button>
      ) : null}
    </article>
  );
}

/**
 * The cover's pointer to the latest weekly episode.
 *
 * Lazy and client-only: the cover is about today's edition, and a week without an episode must
 * leave no trace — no empty block, no error. Any failure to read the index renders nothing.
 */
export function WeeklyCard() {
  const [entry, setEntry] = useState<WeeklyIndex["episodes"][number] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchWeeklyIndex()
      .then((index) => {
        const latest = index?.episodes.find((episode) => episode.weekId === index.latestId) ?? index?.episodes[0];
        if (alive && latest) setEntry(latest);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!entry) return null;

  return (
    <section className="pulso-panel pulso-weekly-card" aria-labelledby="semana-card-titulo">
      <div className="pulso-weekly-card-wave" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} style={{ height: `${28 + Math.round(60 * Math.abs(Math.sin(i * 1.7)))}%` }} />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <p className="pulso-kicker">Pulso da Semana · em áudio</p>
        <h2 id="semana-card-titulo" className="pulso-section-title">
          {entry.title}
        </h2>
        <p className="pulso-note pulso-weekly-disclosure">{entry.description}</p>
        <p className="pulso-meta">
          {formatWeekRange(entry.from, entry.to)} · {formatMinutes(entry.durationSeconds)} · duas vozes sintéticas
        </p>
      </div>
      <Link to={`/semana/${entry.weekId}`} className="pulso-button pulso-button--go">
        Ouvir o episódio
      </Link>
    </section>
  );
}

/** One default export for both lazy call sites, so each needs no wrapper of its own. */
export default function Weekly({ view }: { view: "card" | "page" }) {
  return view === "card" ? <WeeklyCard /> : <WeeklyEpisodePage />;
}
