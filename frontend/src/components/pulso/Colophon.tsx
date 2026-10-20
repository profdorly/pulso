import { Link } from "react-router-dom";
import { ARTICLES_URL, PUBLISHER_NAME, PUBLISHER_URL } from "../../lib/siteBase.js";
import { publicAssetUrl } from "../../lib/paths.js";

/** Publisher and durable ways to keep reading after the edition ends. */
export function Colophon() {
  return (
    <footer className="mt-4 border-t border-border-strong pb-2 pt-8 text-sm leading-relaxed text-muted md:pt-10">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p className="pulso-kicker">Expediente</p>
          <p className="mt-2 max-w-xl">
            Pulso é publicado por{" "}
            <a href={PUBLISHER_URL} className="pulso-link">
              {PUBLISHER_NAME}
            </a>
            . Seleção automatizada, fontes abertas e critérios publicados.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs uppercase tracking-wider" aria-label="Rodapé">
          <a href={ARTICLES_URL} className="pulso-link">artigos</a>
          <a href={publicAssetUrl("feed.xml")} className="pulso-link">RSS</a>
          <Link to="/metodologia/" className="pulso-link">metodologia</Link>
        </nav>
      </div>
    </footer>
  );
}
