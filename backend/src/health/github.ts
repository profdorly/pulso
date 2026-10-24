import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import { runReportSchema, type RunReport } from "../kitchen/runReport.js";
import { mapLimit, request, type Fetch } from "./source.js";

/**
 * The publishing workflow's runs in the window, each with the run reports its kitchen job
 * uploaded (one per attempt; see `Guardar o relatório da corrida` in publicar.yml).
 *
 * Two listings and one small download per report: the runs, then the repository's artifacts by
 * name. On a public repository any signed-in token can read all of it.
 */

export const WORKFLOW_FILE = "publicar.yml";
/** Artifact names the workflow uploads: `run-report-<attempt>.json`. */
export const REPORT_ARTIFACT = /^run-report-\d+\.json$/;

const API = "https://api.github.com";
const PER_PAGE = 100;
const MAX_PAGES = 20;
const MAX_REPORT_BYTES = 1_000_000;

const runSchema = z.object({
  id: z.number(),
  run_number: z.number(),
  run_attempt: z.number().optional(),
  event: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  created_at: z.string(),
  run_started_at: z.string().nullable().optional(),
  updated_at: z.string(),
  html_url: z.string(),
});

const runsPageSchema = z.object({ workflow_runs: z.array(runSchema) });

const artifactSchema = z.object({
  id: z.number(),
  name: z.string(),
  expired: z.boolean(),
  created_at: z.string().nullable(),
  size_in_bytes: z.number().optional(),
  archive_download_url: z.string(),
  workflow_run: z.object({ id: z.number().nullable().optional() }).nullable().optional(),
});

const artifactsPageSchema = z.object({ artifacts: z.array(artifactSchema) });

export interface GithubRun {
  id: number;
  number: number;
  attempt: number;
  event: string;
  status: string | null;
  conclusion: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  url: string;
  reports: RunReport[];
  /** Reports found but unreadable (older schema, corrupt download). */
  unreadableReports: number;
}

export interface GithubData {
  repo: string;
  workflow: string;
  runs: GithubRun[];
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pulso-health",
  };
}

/** Text of a downloaded artifact: the file itself (`archive: false`) or the only entry of a zip. */
export function artifactText(bytes: Buffer): string {
  return (isZip(bytes) ? firstZipEntry(bytes) : bytes).toString("utf8");
}

function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
}

// Read through the central directory, not the local header: a streamed zip leaves the sizes in
// the local header as zero and puts them after the data.
function firstZipEntry(zip: Buffer): Buffer {
  let eocd = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 22 - 0xffff); offset--) {
    if (zip.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip sem diretório central");
  const central = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(central) !== 0x02014b50) throw new Error("zip com diretório central inválido");
  const method = zip.readUInt16LE(central + 10);
  const compressedSize = zip.readUInt32LE(central + 20);
  const local = zip.readUInt32LE(central + 42);
  if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("zip com entrada inválida");
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + compressedSize);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`zip com compressão ${method}, não suportada`);
}

export async function collectGithub(input: {
  repo: string;
  token: string;
  since: Date;
  fetchImpl?: Fetch;
}): Promise<GithubData> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const auth = { headers: headers(input.token) };
  const get = async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
    const response = await request(fetchImpl, "GitHub", `${API}${path}`, auth);
    return schema.parse(await response.json());
  };

  const runs: GithubRun[] = [];
  const createdSince = encodeURIComponent(`>=${input.since.toISOString().slice(0, 10)}`);
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await get(
      `/repos/${input.repo}/actions/workflows/${WORKFLOW_FILE}/runs?created=${createdSince}&per_page=${PER_PAGE}&page=${page}`,
      runsPageSchema
    );
    for (const run of body.workflow_runs) {
      if (Date.parse(run.created_at) < input.since.getTime()) continue;
      runs.push({
        id: run.id,
        number: run.run_number,
        attempt: run.run_attempt ?? 1,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        createdAt: run.created_at,
        startedAt: run.run_started_at ?? null,
        updatedAt: run.updated_at,
        url: run.html_url,
        reports: [],
        unreadableReports: 0,
      });
    }
    if (body.workflow_runs.length < PER_PAGE) break;
  }

  const byId = new Map(runs.map((run) => [run.id, run]));
  const wanted: Array<{ run: GithubRun; url: string; size?: number }> = [];
  // Newest first: once a page reaches back past the window, older pages cannot hold a report.
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await get(`/repos/${input.repo}/actions/artifacts?per_page=${PER_PAGE}&page=${page}`, artifactsPageSchema);
    for (const artifact of body.artifacts) {
      const run = artifact.workflow_run?.id ? byId.get(artifact.workflow_run.id) : undefined;
      if (!run || artifact.expired || !REPORT_ARTIFACT.test(artifact.name)) continue;
      wanted.push({ run, url: artifact.archive_download_url, size: artifact.size_in_bytes });
    }
    const oldest = body.artifacts.at(-1)?.created_at;
    if (body.artifacts.length < PER_PAGE || (oldest && Date.parse(oldest) < input.since.getTime())) break;
  }

  await mapLimit(wanted, 6, async ({ run, url, size }) => {
    try {
      if (size !== undefined && size > MAX_REPORT_BYTES) throw new Error("relatório grande demais");
      // The download redirects to blob storage; fetch drops Authorization on that cross-origin hop.
      const response = await request(fetchImpl, "GitHub", url, auth);
      const parsed = runReportSchema.safeParse(JSON.parse(artifactText(Buffer.from(await response.arrayBuffer()))));
      if (parsed.success) run.reports.push(parsed.data);
      else run.unreadableReports += 1;
    } catch {
      run.unreadableReports += 1;
    }
  });

  for (const run of runs) run.reports.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { repo: input.repo, workflow: WORKFLOW_FILE, runs };
}
