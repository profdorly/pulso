import type { PulsoIndex, PulsoItem } from "./edition.js";

/**
 * Splits an edition into mutually exclusive cover sections.
 *
 * Geography balances who gets in (`select.ts`). It is not a reader-facing caderno: a
 * Brazilian outlet covering Musk is still press, and a lab in São Paulo is still a lab.
 * The cover names the kind of source. Region stays on the item as a dateline.
 */
export interface EditionSections {
  /** First-hand posts from the labs themselves, including discovery of feed-less labs. */
  labs: PulsoItem[];
  /** Independent coverage and analysis, from every region in the edition. */
  press: PulsoItem[];
}

export const SECTION_TITLE = {
  labs: "Direto dos labs",
  press: "Imprensa",
  featured: "Prioridades",
  radar: "Radar",
} as const;

function isPrimary(item: PulsoItem): boolean {
  return item.kind === "lab" || item.kind === "discovery";
}

export function partitionItems(items: PulsoItem[]): EditionSections {
  const labs: PulsoItem[] = [];
  const press: PulsoItem[] = [];

  for (const item of items) {
    if (isPrimary(item)) labs.push(item);
    else press.push(item);
  }

  return { labs, press };
}

/** Total across sections, which must always equal the edition item count. */
export function sectionTotal(sections: EditionSections): number {
  return sections.labs.length + sections.press.length;
}

/** Index is newest-first. */
export function neighboringEditions(index: PulsoIndex, editionId: string) {
  const at = index.editions.findIndex((entry) => entry.id === editionId);
  if (at < 0) return { newer: null, older: null };
  return {
    newer: index.editions[at - 1] ?? null,
    older: index.editions[at + 1] ?? null,
  };
}
