import type { Repositories } from "../db/repositories/index.js";
import { fetchBenchmarks } from "../fetchers/benchmarks.js";
import { fetchRssSources } from "../fetchers/rss.js";
import { searchBeyondFeeds } from "../fetchers/webSearch.js";
import { fetchModelCatalog } from "../models/aa.js";
import { fetchPulsoEditorial } from "./editorial.js";
import { humanizeDigest } from "./humanize.js";
import { defaultEditionsDir, defaultLockPath } from "./paths.js";
import { runEdition, type EditionEnv } from "./runEdition.js";
import type { EditionJobResult, Slot } from "./schema.js";
import { runConfiguredAuditPass } from "./auditPass.js";
import { summarizeEditionItems } from "./summarize.js";
import { verifyEditionLinks } from "./verifyLinks.js";
import { enrichEditionItems } from "./worker.js";

export function editionEnvFromProcess(): EditionEnv {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_MODEL_EDITORIAL: process.env.OPENAI_MODEL_EDITORIAL,
    OPENAI_MODEL_WORKER: process.env.OPENAI_MODEL_WORKER,
    ARTIFICIAL_ANALYSIS_API_KEY: process.env.ARTIFICIAL_ANALYSIS_API_KEY,
    PULSO_MAX_EDITION_USD: process.env.PULSO_MAX_EDITION_USD,
    PULSO_WEB_SEARCH: process.env.PULSO_WEB_SEARCH,
    OPENAI_MODEL_SEARCH: process.env.OPENAI_MODEL_SEARCH,
  };
}

export interface PulsoJobInput {
  slot: Slot;
  force?: boolean;
  benchmarksOnly?: boolean;
  repositories: Repositories;
  editionsDir?: string;
  lockPath?: string;
  env?: EditionEnv;
}

/**
 * One edition (or the Monday catalogue job) against a local kitchen: the SQLite file and the
 * editions directory. Where those come from and where they go afterwards is the caller's
 * business — the CLI uses `data/`, the scheduled workflow downloads them first.
 */
export async function runPulsoJob(input: PulsoJobInput): Promise<EditionJobResult> {
  const editionsDir = input.editionsDir ?? process.env.EDITIONS_DIR ?? defaultEditionsDir();
  return runEdition({
    slot: input.slot,
    force: input.force,
    benchmarksOnly: input.benchmarksOnly,
    editionsDir,
    lockPath: input.lockPath ?? process.env.EDITION_LOCK_PATH ?? defaultLockPath(),
    repositories: input.repositories,
    env: input.env ?? editionEnvFromProcess(),
    fetchers: {
      fetchRssSources,
      // Runs only when PULSO_WEB_SEARCH is set; see runEdition and webSearchShadow.ts.
      searchBeyondFeeds,
      fetchPulsoEditorial,
      humanizeDigest,
      enrichEditionItems,
      verifyEditionLinks,
      summarizeEditionItems,
      auditEditionSummaries: (auditInput) =>
        runConfiguredAuditPass(auditInput, {
          env: {
            OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            PULSO_AUDITOR_PROVIDER: process.env.PULSO_AUDITOR_PROVIDER,
            PULSO_AUDITOR_MODEL: process.env.PULSO_AUDITOR_MODEL,
            PULSO_AUDITOR_REASONING_EFFORT: process.env.PULSO_AUDITOR_REASONING_EFFORT,
          },
        }),
      fetchBenchmarks,
      fetchModelCatalog,
    },
  });
}
