/**
 * The model a source's row belongs to, without its configuration.
 *
 * Artificial Analysis lists each reasoning setting as its own row — "Claude Opus 5.5 (Max)",
 * "(Xhigh)", "(High)" — so a plain top five can be one model five times. Ranking the best row of
 * each family shows five models instead. Copy of `modelFamily` in
 * `frontend/src/lib/modelPicks.ts`; keep the two in step.
 */
export function modelFamily(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

/** The first row of each family, in the order given: pass rows already ranked. */
export function bestOfEachFamily<T>(rows: readonly T[], nameOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    const family = modelFamily(nameOf(row));
    if (seen.has(family)) continue;
    seen.add(family);
    kept.push(row);
  }
  return kept;
}
