import type { PulsoEdition, PulsoItem } from "../../lib/edition.js";
import { itemHeadline } from "../../lib/edition.js";
import { CONTACT_EMAIL } from "../../lib/siteBase.js";

/**
 * The way a reader tells the journal it got something wrong.
 *
 * Renders NOTHING while `CONTACT_EMAIL` is empty. A visible "report an error" control with no
 * address behind it is worse than no control: it invites the reader to spend effort on a message
 * nobody receives, and it makes a promise of correction the site cannot keep. The absence is
 * honest; a dead `mailto:` is not.
 *
 * The subject is pre-filled with edition number, date and — on an item — its headline, because the
 * scarce thing in a correction is not the reader's willingness but the journal's ability to locate
 * what they meant. No prose is pre-filled: the body is the reader's to write.
 *
 * No promise of a reply time appears anywhere here. There is no queue and no rota behind this
 * address, and naming a deadline the operation cannot meet would be the same failure the rest of
 * the pipeline is built to avoid.
 */
export function CorrectionLink({
  edition,
  item,
  label,
  className,
}: {
  /** Absent on `/metodologia`, where the channel is about the journal rather than one edition. */
  edition?: Pick<PulsoEdition, "calendarDate" | "number">;
  item?: PulsoItem;
  label?: string;
  className?: string;
}) {
  if (!CONTACT_EMAIL) return null;

  const parts = [
    edition?.number != null ? `Pulso #${edition.number}` : "Pulso",
    edition?.calendarDate ?? null,
    item ? itemHeadline(item) : null,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);

  const href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(parts.join(" · "))}`;

  return (
    <p className={`pulso-meta ${className ?? ""}`.trim()}>
      <a href={href} className="pulso-link">
        {label ?? (item ? "Corrigir este item" : "Corrigir esta edição")}
      </a>
    </p>
  );
}
