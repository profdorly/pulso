import { z } from "zod";
import { REGIONS, normalizeRegion } from "../types.js";
import { GENRES } from "./genre.js";

export const SLOTS = ["manha", "meio-dia", "tarde"] as const;
export type Slot = (typeof SLOTS)[number];

export const TIMEZONE = "America/Sao_Paulo";

/**
 * Region as stored in artifacts, normalized on read.
 *
 * Editions published before the region split carry `us-global` and `china`. Preprocessing
 * keeps the whole archive parseable instead of making old covers unreadable, and anything
 * outside the known set still fails loudly rather than being mislabelled.
 */
export const regionSchema = z.preprocess(
  (value) => normalizeRegion(value) ?? value,
  z.enum(REGIONS)
);

export const pulsoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  /**
   * Headline rewritten in Portuguese, for a readership that does not necessarily read English.
   *
   * Kept beside the original rather than replacing it: `title` stays the verifiable string that
   * the evidence index reads, and the link still opens the source in its own language. Absent
   * when the translation could not be produced or failed the evidence gate, in which case the
   * reader falls back to `title`.
   */
  titlePt: z.string().optional(),
  blurbPt: z.string().optional(),
  /**
   * One or two paragraphs in Portuguese, written from the article body the link check already
   * downloaded. Absent when the body was unreachable or the model declined — an item publishes
   * with its title and link either way.
   */
  summaryPt: z.string().optional(),
  url: z.string().url(),
  outlet: z.string(),
  region: regionSchema,
  kind: z.enum(["lab", "press", "discovery"]),
  /**
   * Reporting or column. Defaulted so editions published before the split still parse; an
   * opinion piece is labelled rather than hidden, since the harm is only in it passing for
   * a new fact.
   */
  genre: z.enum(GENRES).default("news"),
  /**
   * Host the facts came from, when this item repeats a source we could not fetch. The link
   * still points at the text that was actually read and summarized — naming the origin without
   * linking it is the only way to keep the summary verifiable.
   */
  originHost: z.string().optional(),
  /** Outlets in this edition that carried the same story, counting the original. */
  corroboration: z.number().int().positive().optional(),
  publishedAt: z.string(),
  /**
   * `collected` when the feed did not give a date and the publisher stamped the fetch time.
   * Absent on older artifacts; the reader then keeps the historical "publicado pela fonte".
   */
  publishedAtKind: z.enum(["source", "collected"]).optional(),
  firstSeenAt: z.string(),
});

export const pulsoDigestSchema = z.object({
  headline: z.string(),
  lede: z.string(),
  bullets: z.array(
    z.object({
      text: z.string(),
      url: z.string().url(),
      outlet: z.string(),
    })
  ),
});

export const pulsoCoverSchema = z.object({
  path: z.string(),
  alt: z.string(),
  width: z.number(),
  height: z.number(),
});

export const pulsoBenchmarksSchema = z.object({
  capturedAt: z.string(),
  previousCapturedAt: z.string().nullable(),
  headline: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      delta: z.string().nullable(),
      metric: z.string().optional(),
    })
  ),
  attribution: z.array(z.string()),
  rows: z.unknown(),
});

export const pulsoGateSchema = z.object({
  /** How many generated sentences were checked for risky claims. */
  checked: z.number(),
  bulletsDropped: z.number(),
  blurbsDropped: z.number(),
  /** True when headline or lede could not be supported and fell back to source titles. */
  headlineFellBack: z.boolean(),
  /** A few examples of what was rejected, for auditing without exposing full text. */
  unsupportedSamples: z.array(z.string()),
});

export const pulsoEditionSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  slot: z.enum(SLOTS),
  calendarDate: z.string(),
  timezone: z.literal(TIMEZONE),
  capturedAt: z.string(),
  status: z.enum(["ok", "partial"]),
  /**
   * `regular` carries items. `quiet` is published when nothing survived verification and
   * the previous edition is too old to still read as current — an honest empty edition
   * instead of a stale cover.
   */
  kind: z.enum(["regular", "quiet"]).default("regular"),
  /**
   * Sequential edition number, shown to readers as `PULSO #N`. Assigned once, at
   * publication, and never recomputed: deriving it from the index at render time would
   * renumber the whole archive whenever an edition is added or removed, so a link
   * someone saved to "#12" would silently start pointing at different news. Optional
   * because artifacts published before numbering exist and must keep parsing; the UI
   * omits the number instead of inventing one.
   */
  number: z.number().int().positive().optional(),
  predecessorId: z.string().nullable(),
  /**
   * Increments when a slot is republished with `force`. Revision 1 is the first
   * publication; the artifact it replaced is kept alongside it as a superseded file.
   */
  revision: z.number().int().positive().default(1),
  /** `capturedAt` of the artifact this one replaced, when it is a forced republish. */
  supersedesCapturedAt: z.string().nullable().default(null),
  digest: pulsoDigestSchema,
  items: z.array(pulsoItemSchema),
  sourceFailures: z.array(
    z.object({
      sourceId: z.string(),
      name: z.string(),
      error: z.string(),
    })
  ),
  benchmarks: pulsoBenchmarksSchema,
  models: z.object({
    /** Only in editions published before 31 Oct 2026; never read, no longer written. */
    discovery: z.string().optional(),
    editorial: z.string(),
    worker: z.string(),
  }),
  costUsdApprox: z.number(),
  /** Per-step cost breakdown, so the published total can be audited. */
  costBreakdown: z
    .array(
      z.object({
        step: z.string(),
        model: z.string(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        webSearchCalls: z.number(),
        usd: z.number(),
      })
    )
    .default([]),
  gate: pulsoGateSchema.default({
    checked: 0,
    bulletsDropped: 0,
    blurbsDropped: 0,
    headlineFellBack: false,
    unsupportedSamples: [],
  }),
  cover: pulsoCoverSchema.optional(),
});

export const pulsoIndexSchema = z.object({
  schemaVersion: z.literal(1),
  latestId: z.string().nullable(),
  editions: z.array(
    z.object({
      id: z.string(),
      slot: z.enum(SLOTS),
      calendarDate: z.string(),
      capturedAt: z.string(),
      /** Mirrors the artifact's number so the archive list can label entries without loading each one. */
      number: z.number().int().positive().optional(),
      headline: z.string(),
      path: z.string(),
    })
  ),
});

export type PulsoItem = z.infer<typeof pulsoItemSchema>;
export type PulsoDigest = z.infer<typeof pulsoDigestSchema>;
export type PulsoCover = z.infer<typeof pulsoCoverSchema>;
export type PulsoBenchmarks = z.infer<typeof pulsoBenchmarksSchema>;
export type PulsoGate = z.infer<typeof pulsoGateSchema>;
export type PulsoEdition = z.infer<typeof pulsoEditionSchema>;
export type PulsoIndex = z.infer<typeof pulsoIndexSchema>;

export type EditionJobStatus = "published" | "unchanged" | "partial" | "error";

export interface EditionQuality {
  kind: "regular" | "quiet";
  items: number;
  /** Items that kept their Portuguese paragraph after every check. */
  withSummary: number;
  feedsFailed: number;
  /** sourceIds of the pipeline's own notes (pulso-audit, pulso-cost...), without their text. */
  stepNotes: string[];
  /** Paragraphs the fidelity audit checked and removed; null when the audit did not run. */
  audited: number | null;
  auditRemoved: number | null;
  /** Bullets and blurbs the final number/claim gate dropped. */
  gateDropped: number;
  headlineFellBack: boolean;
}

export type CostBreakdownRow = PulsoEdition["costBreakdown"][number];

export interface EditionJobResult {
  status: EditionJobStatus;
  editionId: string | null;
  newItemCount: number;
  costUsdApprox: number;
  /**
   * What `costUsdApprox` is made of, on every exit — also the ones that publish nothing or fail.
   * The edition artifact keeps it only when an edition is written; the run report keeps it always.
   */
  costBreakdown?: CostBreakdownRow[];
  /** What a written edition carries, in numbers only; absent when nothing was written. */
  quality?: EditionQuality;
  revision?: number;
  skippedReason?: "no-delta" | "slot-already-published" | "locked";
  error?: string;
}
