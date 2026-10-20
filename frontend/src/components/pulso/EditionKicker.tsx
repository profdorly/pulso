import type { PulsoEdition } from "../../lib/edition.js";
import { formatEditionDate, formatUpdatedAt } from "../../lib/formatPt.js";

interface EditionKickerProps {
  edition: Pick<PulsoEdition, "number" | "calendarDate" | "capturedAt">;
}

/**
 * The line above the headline that tells the reader which edition they are looking at.
 *
 * It sits in the page body and not in `<title>`: prefixing the document title with
 * `Pulso #12 —` would spend roughly a fifth of the ~60 characters a search result shows
 * on a string that means nothing to someone arriving from search, and a title that leads
 * with boilerplate instead of the news invites Google to rewrite it. Numbering is a brand
 * device for people already reading, so it lives where people already reading can see it.
 *
 * `status` and `revision` are deliberately absent. "parcial" and "revisão 3" describe how the
 * pipeline ran, not what the reader is holding: a partial edition is one where some source
 * failed, which is an operational fact already recorded in status.json, and a revision number
 * only invites the question of what changed without answering it. Both belong to whoever
 * operates the publisher, and they are still in the artifact for that.
 */
export function EditionKicker({ edition }: EditionKickerProps) {
  // Separated by hairlines drawn in CSS, not by a row of middle dots.
  return (
    <p className="pulso-editionline">
      {edition.number != null ? <span className="pulso-edition-number">Pulso #{edition.number}</span> : null}
      <span>{formatEditionDate(edition.calendarDate)}</span>
      <span>atualizado às {formatUpdatedAt(edition.calendarDate, edition.capturedAt)}</span>
    </p>
  );
}
