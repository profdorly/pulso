import { z } from "zod";
import { MODALITIES, MODALITY_GROUPS } from "./types.js";

/**
 * Wire schema for the published `models.json`.
 *
 * The catalogue is published as its own artifact rather than embedded in every edition:
 * it is the same few hundred models for all three slots of a day, and duplicating it per
 * edition made each artifact grow without adding information.
 */

export const metricKeySchema = z.enum([
  "intelligence-index",
  "coding-index",
  "agentic-index",
  "price-input-1m",
  "price-output-1m",
  "output-tokens-per-second",
  "time-to-first-token",
  "end-to-end-latency",
  "arena-elo",
]);

export const metricObservationSchema = z.object({
  metric: metricKeySchema,
  value: z.number(),
  source: z.enum(["artificial-analysis"]),
  benchmark: z.string(),
  benchmarkVersion: z.string().optional(),
  confidence95: z.number().optional(),
  sampleSize: z.number().optional(),
  capturedAt: z.string(),
  methodologyUrl: z.string(),
});

export const modelRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  creator: z.string(),
  modality: z.enum(MODALITIES),
  releaseDate: z.string().optional(),
  observations: z.array(metricObservationSchema),
});

export const modalitySectionSchema = z.object({
  modality: z.enum(MODALITIES),
  group: z.enum(MODALITY_GROUPS),
  availableMetrics: z.array(metricKeySchema),
  models: z.array(modelRecordSchema),
  /** Defaulted so catalogues captured before the publish cap still parse. */
  totalAvailable: z.number().default(0),
  notes: z.array(z.string()),
});

const changedModelSchema = z.object({ id: z.string(), name: z.string(), creator: z.string() });

export const catalogChangesSchema = z.object({
  since: z.string(),
  comparable: z.boolean(),
  indexVersions: z.object({ before: z.string().nullable(), after: z.string().nullable() }).optional(),
  entered: z.array(changedModelSchema),
  left: z.array(changedModelSchema),
  moved: z.array(changedModelSchema.extend({ metric: metricKeySchema, before: z.number(), after: z.number() })),
  leaders: z.array(z.object({ modality: z.enum(MODALITIES), before: changedModelSchema, after: changedModelSchema })),
});

export const modelCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string(),
  sources: z.array(z.enum(["artificial-analysis"])),
  sections: z.array(modalitySectionSchema),
  coverage: z.array(
    z.object({
      modality: z.enum(MODALITIES),
      metric: metricKeySchema,
      withData: z.number(),
      total: z.number(),
    })
  ),
  changes: catalogChangesSchema.optional(),
});

export type ModelCatalogWire = z.infer<typeof modelCatalogSchema>;
