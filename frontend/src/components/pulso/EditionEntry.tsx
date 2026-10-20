import { Link } from "react-router-dom";
import type { PulsoIndex } from "../../lib/edition.js";
import { editionPath } from "../../lib/editionPaths.js";
import { pageRoute } from "../../lib/paths.js";
import { formatEditionDate, formatUpdatedAt } from "../../lib/formatPt.js";

/**
 * One edition in a running list: the archive and the front-page feed.
 *
 * The metadata stacks in a narrow column instead of running as one uppercase line, which
 * wrapped mid-date at this width and made the number and the day read as one token.
 */
export function EditionEntry({
  entry,
  withTime = false,
}: {
  entry: PulsoIndex["editions"][number];
  withTime?: boolean;
}) {
  return (
    <li className="pulso-entry">
      <p className="pulso-entry-meta">
        {entry.number != null ? <span className="pulso-edition-number">Pulso #{entry.number}</span> : null}
        <span>{formatEditionDate(entry.calendarDate)}</span>
        {withTime ? <span>atualizada às {formatUpdatedAt(entry.calendarDate, entry.capturedAt)}</span> : null}
      </p>
      <Link to={pageRoute(editionPath(entry.calendarDate, entry.slot))} className="pulso-entry-title">
        {entry.headline}
      </Link>
    </li>
  );
}
