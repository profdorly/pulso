/* eslint-disable react-refresh/only-export-components --
   Context module: the provider and the hooks that read it belong together, and splitting them
   only to satisfy Fast Refresh would make the data flow harder to follow. */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PulsoEdition, PulsoIndex } from "./edition.js";
import type { ModelCatalog } from "./modelCatalog.js";
import type { WeeklyIndex } from "./weekly.js";
import { EditionNotFoundError } from "./editionsApi.js";

/**
 * Lets a page render from data that is already in hand.
 *
 * The prerender step knows every edition at build time, so it seeds this context and the
 * pages render their real content to HTML. In the browser the same components fall back to
 * fetching, which keeps the client-only dev flow working unchanged.
 */

export interface PreloadedEditionData {
  edition?: PulsoEdition | null;
  index?: PulsoIndex | null;
  /** Model catalogue, for the models route. */
  catalog?: ModelCatalog | null;
  /** Every weekly episode, for the `/semana/` list. */
  weeklyIndex?: WeeklyIndex | null;
  /** Set when the requested edition is known not to exist. */
  notFound?: boolean;
}

/** Id of the JSON block a hydrated page carries (only the weekly audio hydrates). */
export const PULSO_DATA_SCRIPT_ID = "pulso-data";

/**
 * Reads the prerendered payload without executing it: a `type="application/json"` block is data,
 * not a script, so it needs no allowance in the Content-Security-Policy.
 */
export function readPreloadedData(root: ParentNode = document): PreloadedEditionData | null {
  const el = root.querySelector(`#${PULSO_DATA_SCRIPT_ID}`);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as PreloadedEditionData;
  } catch {
    return null;
  }
}

const EditionDataContext = createContext<PreloadedEditionData | null>(null);

export function EditionDataProvider({
  value,
  children,
}: {
  value: PreloadedEditionData | null;
  children: ReactNode;
}) {
  return <EditionDataContext.Provider value={value}>{children}</EditionDataContext.Provider>;
}

export function usePreloadedEditionData(): PreloadedEditionData | null {
  return useContext(EditionDataContext);
}

/**
 * The preloaded context describes exactly one URL: the route the prerender step was writing
 * when it seeded the HTML. A later client-side navigation lands on this component with that
 * same context still in place, so trusting it blindly renders one edition under another
 * edition's address. Only a match between the seeded artifact and the route params counts.
 */
export function preloadedEditionFor(
  preloaded: PreloadedEditionData | null,
  date: string | undefined,
  slot: string | undefined
): PulsoEdition | null {
  const edition = preloaded?.edition;
  if (!edition || !date || !slot) return null;
  return edition.calendarDate === date && edition.slot === slot ? edition : null;
}

export interface AsyncResource<T> {
  data: T | null;
  error: string | null;
  notFound: boolean;
}

/**
 * Resolves a value from the preloaded context, or fetches it once per `deps` change.
 *
 * `preloaded` short-circuits the fetch so a prerendered page never refetches what the HTML
 * already contains. A change of `deps` (edition date/slot) must not keep showing the previous
 * artifact; the request key makes that stale state look like a load, without a synchronous
 * setState in the effect.
 */
export function useEditionResource<T>(
  preloaded: T | null | undefined,
  load: () => Promise<T>,
  deps: unknown[],
  preloadedNotFound = false
): AsyncResource<T> {
  const requestKey = JSON.stringify(deps);
  const [fetched, setFetched] = useState<{
    key: string;
    data: T | null;
    error: string | null;
    notFound: boolean;
  }>({
    key: requestKey,
    data: preloaded ?? null,
    error: null,
    notFound: preloadedNotFound,
  });

  useEffect(() => {
    if (preloaded || preloadedNotFound) return undefined;

    let cancelled = false;
    load()
      .then((next) => {
        if (!cancelled) {
          setFetched({ key: requestKey, data: next, error: null, notFound: false });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof EditionNotFoundError) {
          setFetched({ key: requestKey, data: null, error: null, notFound: true });
          return;
        }
        setFetched({
          key: requestKey,
          data: null,
          error: err instanceof Error ? err.message : "Falha ao carregar",
          notFound: false,
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  if (preloaded) return { data: preloaded, error: null, notFound: false };
  if (preloadedNotFound) return { data: null, error: null, notFound: true };
  if (fetched.key !== requestKey) return { data: null, error: null, notFound: false };
  return { data: fetched.data, error: fetched.error, notFound: fetched.notFound };
}
