import { itemHeadline, type PulsoItem } from "./edition.js";

/** The Portuguese summary as paragraphs; empty when the item has none. Never invented. */
export function summaryParagraphs(item: Pick<PulsoItem, "summaryPt">): string[] {
  return (
    item.summaryPt
      ?.split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean) ?? []
  );
}

/**
 * Anchor of an item inside its edition page. An item has no page of its own: sharing one item
 * means sharing the edition scrolled to it. Ten hex characters of the URL hash are unique within
 * an edition and keep the shared link short.
 */
export function itemAnchor(item: Pick<PulsoItem, "id">): string {
  return `n-${item.id.slice(0, 10)}`;
}

/** Plain text that keeps the source visible when pasted into WhatsApp, email or a document. */
export function itemShareText(item: PulsoItem, pulsoUrl?: string): string {
  const context = item.blurbPt?.trim() || summaryParagraphs(item)[0] || "";
  return [
    `*${itemHeadline(item)}*`,
    context,
    `Fonte: ${item.outlet}\n${item.url}`,
    pulsoUrl ? `No Pulso:\n${pulsoUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
