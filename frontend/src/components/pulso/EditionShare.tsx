import type { PulsoEdition } from "../../lib/edition.js";
import { editionPath } from "../../lib/editionPaths.js";
import { absoluteUrl } from "../../lib/seo.js";
import { formatEditionDate } from "../../lib/formatPt.js";
import { whatsappShareUrl } from "../../lib/shareUrl.js";

/** Plain text that reads as a recommendation when pasted into WhatsApp, email or a document. */
function editionShareText(edition: PulsoEdition, pulsoUrl?: string): string {
  return [
    `*Pulso · ${formatEditionDate(edition.calendarDate)}*`,
    `*${edition.digest.headline}*`,
    edition.digest.lede,
    pulsoUrl ? `Leia no Pulso:\n${pulsoUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Plain links, so sharing works on a page that ships no script. */
export function EditionShare({ edition }: { edition: PulsoEdition }) {
  const publicUrl = absoluteUrl(editionPath(edition.calendarDate, edition.slot));
  const whatsappUrl = whatsappShareUrl(editionShareText(edition, publicUrl));
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(publicUrl)}`;

  return (
    <div className="pulso-share">
      <p className="pulso-kicker">Compartilhar esta edição</p>
      <div className="flex flex-wrap gap-2">
        <a className="pulso-pill pulso-pill--solid" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
        <a className="pulso-pill" href={linkedinUrl} target="_blank" rel="noopener noreferrer">
          LinkedIn
        </a>
      </div>
    </div>
  );
}
