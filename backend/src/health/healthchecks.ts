import { z } from "zod";
import { request, type Fetch } from "./source.js";

/**
 * The project's checks on Healthchecks.io, read with the project's read-only API key.
 *
 * That key already leaves out the ping URLs and UUIDs — whoever has a ping URL can mark the check
 * as up — and the schema below drops everything else the page does not show, `unique_key`
 * included, so none of it reaches the snapshot or the page even if a read-write key is used.
 */

const API = "https://healthchecks.io/api/v3";

const checkSchema = z.object({
  name: z.string(),
  status: z.string(),
  last_ping: z.string().nullable(),
  next_ping: z.string().nullable(),
  grace: z.number(),
  schedule: z.string().optional(),
  tz: z.string().optional(),
  timeout: z.number().optional(),
});

const checksSchema = z.object({ checks: z.array(checkSchema) });

export interface HealthcheckRow {
  name: string;
  /** new | up | grace | down | paused */
  status: string;
  lastPing: string | null;
  nextPing: string | null;
  graceSeconds: number;
  /** Cron expression and its time zone, or a period in seconds. */
  schedule: string | null;
}

export interface HealthchecksData {
  checks: HealthcheckRow[];
}

export async function collectHealthchecks(input: { apiKey: string; fetchImpl?: Fetch }): Promise<HealthchecksData> {
  const response = await request(input.fetchImpl ?? fetch, "Healthchecks.io", `${API}/checks/`, {
    headers: { "X-Api-Key": input.apiKey, "User-Agent": "pulso-health" },
  });
  const { checks } = checksSchema.parse(await response.json());
  return {
    checks: checks
      .map((check) => ({
        name: check.name,
        status: check.status,
        lastPing: check.last_ping,
        nextPing: check.next_ping,
        graceSeconds: check.grace,
        schedule: check.schedule
          ? `${check.schedule} (${check.tz ?? "UTC"})`
          : check.timeout !== undefined
            ? `a cada ${check.timeout} s`
            : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}
