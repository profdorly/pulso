import type { PulsoEdition, PulsoItem } from "../../lib/edition.js";
import { itemHeadline, REGION_LABEL } from "../../lib/edition.js";
import { editionPath } from "../../lib/editionPaths.js";
import { itemAnchor, itemShareText, summaryParagraphs } from "../../lib/itemPage.js";
import { trackEvent } from "../../lib/analytics.js";
import { absoluteUrl } from "../../lib/seo.js";
import { externalHref } from "../../lib/safeUrl.js";
import { whatsappShareUrl } from "../../lib/shareUrl.js";

/**
 * One section of an edition's items.
 *
 * An item has no page of its own. Its headline is the link to the original reporting, and its
 * Portuguese summary opens in place (`<details>`, no script): the edition is the only document.
 * Each item carries an anchor, so sharing one item shares the edition scrolled to it.
 */
export function CompactItems({
  id,
  title,
  items,
  edition,
  detailed = false,
}: {
  /** Anchor for the edition's table of contents. */
  id?: string;
  title: string;
  items: PulsoItem[];
  edition: Pick<PulsoEdition, "calendarDate" | "slot">;
  /** The edition's priorities: the summary is open from the start. */
  detailed?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section id={id} className={detailed ? "pulso-stories pulso-stories--featured" : "pulso-stories"}>
      <div className="pulso-stories-head">
        <h2 className="pulso-section-title">{title}</h2>
        <p className="pulso-note">
          {items.length} {items.length === 1 ? "item" : "itens"}
        </p>
      </div>
      <ul>
        {items.map((item) => {
          const anchor = itemAnchor(item);
          const shareUrl = `${absoluteUrl(editionPath(edition.calendarDate, edition.slot))}#${anchor}`;
          const whatsappUrl = whatsappShareUrl(itemShareText(item, shareUrl));
          const paragraphs = summaryParagraphs(item);

          return (
            <li key={item.id} id={anchor} className="pulso-story">
              <p className="pulso-kicker">
                {item.outlet}
                <span> · {REGION_LABEL[item.region]}</span>
                {item.originHost ? <span> · original: {item.originHost}</span> : null}
                {item.corroboration && item.corroboration > 1 ? (
                  <span> · {item.corroboration} veículos</span>
                ) : null}
                {item.genre === "opinion" ? <span className="pulso-tag">Opinião</span> : null}
              </p>
              <a
                href={externalHref(item.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="pulso-story-title"
                onClick={() => trackEvent("source_outbound", { outlet: item.outlet, item_id: item.id })}
              >
                {itemHeadline(item)}
              </a>
              {item.blurbPt ? <p className="pulso-story-text pulso-story-text--muted">{item.blurbPt}</p> : null}
              {paragraphs.length > 0 ? (
                <details className="pulso-story-summary" open={detailed}>
                  <summary>Resumo</summary>
                  {paragraphs.map((paragraph) => (
                    <p key={paragraph.slice(0, 60)} className="pulso-story-text">
                      {paragraph}
                    </p>
                  ))}
                </details>
              ) : null}
              <div className="pulso-story-actions">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pulso-action pulso-action--muted"
                >
                  Compartilhar no WhatsApp
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
