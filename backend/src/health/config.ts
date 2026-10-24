import path from "node:path";

/** Cloudflare's analytics answer for one month at most, and the window covers all four sources. */
export const MAX_DAYS = 30;
export const DEFAULT_DAYS = 30;

export interface HealthSettings {
  days: number;
  outDir: string;
  github: { repo?: string; token?: string };
  healthchecks: { apiKey?: string };
  cloudflare: { accountId?: string; token?: string; worker?: string; crons: string[] };
}

type Env = Record<string, string | undefined>;

function argValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

export function parseDays(argv: readonly string[]): number {
  const raw = argValue(argv, "--days");
  if (raw === undefined) return DEFAULT_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`--days precisa ser um inteiro de 1 a ${MAX_DAYS}`);
  }
  return days;
}

/** `owner/repo` from an https or ssh GitHub remote. */
export function repoFromRemote(url: string | undefined): string | undefined {
  const match = url?.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** The Worker's name and cron list, read from its wrangler.jsonc so a fork needs no extra setting. */
export function workerFromWrangler(text: string | undefined): { name?: string; crons: string[] } {
  if (!text) return { crons: [] };
  const name = /"name"\s*:\s*"([^"]+)"/.exec(text)?.[1];
  const list = /"crons"\s*:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? "";
  const crons = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return { name, crons };
}

const nonEmpty = (value: string | undefined) => (value && value.trim() !== "" ? value.trim() : undefined);

/**
 * Settings from the command line, the environment and `.env.health`.
 *
 * The file wins over the shell, and every name carries the PULSO_HEALTH_ prefix: a broader token
 * that happens to be exported (wrangler's CLOUDFLARE_API_TOKEN, a GITHUB_TOKEN) is never picked up
 * in place of the read-only one the file names.
 */
export function resolveSettings(input: {
  argv: readonly string[];
  env: Env;
  envFile: Env;
  wrangler?: string;
  remote?: string;
  /** Called only when no token is configured: `gh auth token`. */
  ghToken: () => string | undefined;
  root: string;
  cwd: string;
}): HealthSettings {
  // An empty line copied from .env.health.example does not hide a value exported in the shell.
  const fromFile = Object.entries(input.envFile).filter(([, value]) => value !== undefined && value.trim() !== "");
  const env: Env = { ...input.env, ...Object.fromEntries(fromFile) };
  const worker = workerFromWrangler(input.wrangler);
  const out = argValue(input.argv, "--out");

  return {
    days: parseDays(input.argv),
    outDir: out ? path.resolve(input.cwd, out) : path.join(input.root, ".tmp", "health"),
    github: {
      repo: nonEmpty(env.PULSO_HEALTH_REPO) ?? repoFromRemote(input.remote),
      token: nonEmpty(env.PULSO_HEALTH_GITHUB_TOKEN) ?? nonEmpty(input.ghToken()),
    },
    healthchecks: { apiKey: nonEmpty(env.PULSO_HEALTH_HEALTHCHECKS_KEY) },
    cloudflare: {
      accountId: nonEmpty(env.PULSO_HEALTH_CLOUDFLARE_ACCOUNT_ID),
      token: nonEmpty(env.PULSO_HEALTH_CLOUDFLARE_TOKEN),
      worker: nonEmpty(env.PULSO_HEALTH_WORKER) ?? worker.name,
      crons: worker.crons,
    },
  };
}

/** Every credential value, for scrubbing error text before it reaches the page. */
export function secretValues(settings: HealthSettings): string[] {
  return [
    settings.github.token,
    settings.healthchecks.apiKey,
    settings.cloudflare.token,
    settings.cloudflare.accountId,
  ].filter((value): value is string => Boolean(value));
}
