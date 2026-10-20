import { withoutOutletPrefix } from "../../lib/digestText.js";
import { trackEvent } from "../../lib/analytics.js";
import { externalHref } from "../../lib/safeUrl.js";

export function DigestBullets({
  bullets,
  title,
}: {
  bullets: { text: string; url: string; outlet: string }[];
  /** Section heading; omitted where the surrounding page already names the list. */
  title?: string;
}) {
  if (bullets.length === 0) return null;

  // One column: a bullet is a full sentence, and two per row wrapped each into a fragment.
  const list = (
    <ol className="pulso-digest">
      {bullets.map((bullet, i) => (
        <li key={bullet.url}>
          <span className="pulso-digest-pos" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div>
            <a
              href={externalHref(bullet.url)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("source_outbound", { outlet: bullet.outlet })}
            >
              {withoutOutletPrefix(bullet.text, bullet.outlet)}
            </a>
            <span className="pulso-meta">{bullet.outlet}</span>
          </div>
        </li>
      ))}
    </ol>
  );

  if (!title) return list;
  return (
    <section aria-labelledby="em-resumo">
      <h2 id="em-resumo" className="pulso-kicker mb-5">
        {title}
      </h2>
      {list}
    </section>
  );
}
