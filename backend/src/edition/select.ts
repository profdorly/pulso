import { REGIONS, type NewsItem, type Region } from "../types.js";
import { compareByEditorialRank } from "./materiality.js";

/**
 * Picks what goes into an edition.
 *
 * The previous rule was `sort by publishedAt desc` then take the first 25, and it produced
 * covers that were entirely Brazilian. Recency is not a neutral tiebreaker here — two biases
 * push the same way:
 *
 *   Volume. Brazilian general-tech outlets publish many items a day; OpenAI, DeepMind and
 *   Anthropic publish a few a week. Ordering by recency orders by publishing frequency.
 *
 *   Timezone. At run time in São Paulo a local item can be minutes old while an item from SCMP
 *   or Pandaily is already hours old, because it was published on Asian hours. Ordering by
 *   recency orders by proximity to the run's timezone.
 *
 * No prompt can fix that: the international items were cut before any model saw them. So the
 * selection itself carries the editorial rule. The reader-facing cover still groups by source
 * kind (press vs lab), not by region — geography is a quota here and a dateline on the item.
 */

/**
 * How many items one edition may carry.
 *
 * 50 is the two former daily editions (25 each) added together. The Pulso moved to one edition
 * a day at 07:30, and that edition is meant to cover what the morning and afternoon editions
 * covered between them, even if it reads longer.
 */
export const NEW_ITEM_CAP = 50;

/**
 * Slots the geographic quota is guaranteed, even on a heavy announcement day.
 *
 * Without a floor, a launch day with twenty lab posts would leave the quota nothing to
 * balance, and the cover would silently go back to being single-region. 16 is the 8 each of
 * the two former daily editions guaranteed.
 */
export const PRESS_MIN_SLOTS = 16;

/**
 * How many press slots a single outlet may take in one edition.
 *
 * The region quota balanced continents but not newsrooms, so a high-volume wire could satisfy
 * a whole continent by itself: one edition came out with ten of fifteen items from the same
 * outlet's general business feed. Balance across regions is meaningless if a region is one
 * publisher. Three per 25-item edition was enough for an outlet that genuinely owns the day's
 * story and low enough that the edition still read as a survey rather than a reprint; the daily
 * edition is two of those, so an outlet keeps the same daily maximum and the same share.
 */
export const PRESS_SOURCE_CAP = 6;

export type ItemClass = "primary" | "press";

/**
 * Lab announcements and discovery findings are primary sources: the announcement *is* the
 * fact. They sit outside the geographic quota, because rationing a primary announcement by
 * the continent it came from would be censoring a fact for its origin.
 */
export function classify(item: NewsItem): ItemClass {
  return item.block === "official" || item.block === "ai-discovery" ? "primary" : "press";
}

function publishedTime(item: NewsItem): number {
  const parsed = Date.parse(item.publishedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Orders press within a region.
 *
 * Reporting outranks opinion, then business materiality outranks a generic recap,
 * then newer outranks older.
 *
 * Corroboration across outlets is the strongest newsworthiness signal and is deliberately not
 * here. Knowing that two items are the same story requires reading both pages, and pages are
 * only fetched for items that already made the cut — fetching every candidate in the window
 * would multiply requests against every publisher on every run. So corroboration is computed
 * after selection and shown to the reader; it does not decide who gets in.
 */
function comparePress(left: NewsItem, right: NewsItem): number {
  return compareByEditorialRank(left, right, publishedTime);
}

export interface SelectionResult {
  selected: NewsItem[];
  /** Did not fit this edition. Still eligible: the caller defers rather than rejects. */
  deferred: NewsItem[];
  /** How many press slots each region actually filled, for the run log. */
  pressByRegion: Record<Region, number>;
}

export interface SelectOptions {
  cap?: number;
  pressMinSlots?: number;
  /** Press slots one outlet may take; see PRESS_SOURCE_CAP. */
  pressSourceCap?: number;
}

/**
 * Fills press slots by taking from whichever region has taken the fewest so far.
 *
 * A fixed region order would hand the leftover slot of every partial round to the same
 * region. Choosing the least-served region at each step is deterministic and gives the
 * remainder to whoever is behind, which is what "balance" has to mean when the number of
 * slots does not divide evenly.
 */
function fillPressSlots(press: NewsItem[], slots: number, sourceCap: number): NewsItem[] {
  const queues = new Map<Region, NewsItem[]>();
  for (const region of REGIONS) queues.set(region, []);
  for (const item of press) queues.get(item.region)?.push(item);

  // The per-outlet cap is applied to the sorted queue, before balancing, so each region offers
  // its best-ranked items from up to `sourceCap` per outlet and the overflow simply never
  // competes. Doing it here rather than inside the loop keeps the balancing rule readable: the
  // loop still just picks whichever region is behind. A source maps to exactly one region, so
  // trimming per region is the same as trimming globally.
  for (const [region, queue] of queues) {
    queue.sort(comparePress);
    const perSource = new Map<string, number>();
    queues.set(
      region,
      queue.filter((item) => {
        const taken = perSource.get(item.sourceId) ?? 0;
        if (taken >= sourceCap) return false;
        perSource.set(item.sourceId, taken + 1);
        return true;
      })
    );
  }

  const taken = new Map<Region, number>(REGIONS.map((region) => [region, 0]));
  const chosen: NewsItem[] = [];

  while (chosen.length < slots) {
    let best: Region | undefined;
    for (const region of REGIONS) {
      if ((queues.get(region)?.length ?? 0) === 0) continue;
      if (best === undefined) {
        best = region;
        continue;
      }
      const bestTaken = taken.get(best) ?? 0;
      const regionTaken = taken.get(region) ?? 0;
      if (regionTaken < bestTaken) {
        best = region;
      } else if (regionTaken === bestTaken) {
        // Same standing: the better-ranked candidate breaks the tie.
        const bestNext = queues.get(best)![0];
        const regionNext = queues.get(region)![0];
        if (bestNext && regionNext && comparePress(regionNext, bestNext) < 0) best = region;
      }
    }
    if (best === undefined) break; // every region is empty
    chosen.push(queues.get(best)!.shift()!);
    taken.set(best, (taken.get(best) ?? 0) + 1);
  }

  return chosen;
}

export function selectForEdition(
  candidates: NewsItem[],
  options: SelectOptions = {}
): SelectionResult {
  const cap = options.cap ?? NEW_ITEM_CAP;
  const pressMin = options.pressMinSlots ?? PRESS_MIN_SLOTS;
  const pressSourceCap = options.pressSourceCap ?? PRESS_SOURCE_CAP;

  const primary: NewsItem[] = [];
  const press: NewsItem[] = [];
  for (const item of candidates) {
    (classify(item) === "primary" ? primary : press).push(item);
  }
  primary.sort((left, right) => compareByEditorialRank(left, right, publishedTime));

  // Press keeps a floor so the quota always has something to balance, but the floor can never
  // take more than half the edition: it exists to protect balance, not to outrank a primary
  // announcement. Without the halving, a small cap let the floor starve primaries entirely.
  const pressReserved = Math.min(pressMin, press.length, Math.floor(cap / 2));
  const primaryTake = Math.min(primary.length, Math.max(cap - pressReserved, 0));
  const pressTake = Math.min(press.length, Math.max(cap - primaryTake, 0));

  const chosenPrimary = primary.slice(0, primaryTake);
  const chosenPress = fillPressSlots(press, pressTake, pressSourceCap);

  const selectedUrls = new Set([...chosenPrimary, ...chosenPress].map((item) => item.url));
  const deferred = candidates.filter((item) => !selectedUrls.has(item.url));

  const pressByRegion = Object.fromEntries(REGIONS.map((region) => [region, 0])) as Record<
    Region,
    number
  >;
  for (const item of chosenPress) pressByRegion[item.region] += 1;

  // Newest first overall, so the edition still reads chronologically.
  const selected = [...chosenPrimary, ...chosenPress].sort(
    (left, right) => publishedTime(right) - publishedTime(left)
  );

  return { selected, deferred, pressByRegion };
}
