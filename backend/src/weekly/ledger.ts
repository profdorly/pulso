import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { usageCostUsd } from "../edition/cost.js";
import type { CallLog } from "./narrative.js";

/**
 * Every model call made for one week's episode, across runs, with its price.
 *
 * Appended, never rewritten: a script regenerated twice was paid for twice, and the week's cost
 * has to say so. Prices come from the same table as the daily edition (`edition/cost.ts`); a
 * model missing from it is listed as unpriced rather than counted as free.
 */

export interface LedgerEntry extends CallLog {
  at: string;
  usd: number;
  priced: boolean;
}

const FILE = "calls.json";

export function readCalls(dir: string): LedgerEntry[] {
  const file = path.join(dir, FILE);
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, "utf8")) as Array<CallLog & Partial<LedgerEntry>>;
  // Pilot files predate the price and the timestamp; price them now so the total is complete.
  return raw.map((call) => {
    const { usd, priced } = call.usage ? usageCostUsd(call.model, call.usage) : { usd: 0, priced: false };
    return { at: call.at ?? "", ...call, usd: call.usd ?? usd, priced: call.priced ?? priced };
  });
}

export function appendCalls(dir: string, logs: CallLog[]): LedgerEntry[] {
  const at = new Date().toISOString();
  const added = logs.map((log) => {
    const { usd, priced } = log.usage ? usageCostUsd(log.model, log.usage) : { usd: 0, priced: false };
    return { ...log, at, usd: Number(usd.toFixed(6)), priced };
  });
  writeFileSync(path.join(dir, FILE), `${JSON.stringify([...readCalls(dir), ...added], null, 2)}\n`);
  return added;
}

export function callsTotal(entries: LedgerEntry[]): { usd: number; unpriced: string[] } {
  return {
    usd: Number(entries.reduce((sum, entry) => sum + entry.usd, 0).toFixed(4)),
    unpriced: [...new Set(entries.filter((entry) => !entry.priced).map((entry) => entry.model))],
  };
}

export function formatUsd(value: number): string {
  return `US$ ${value.toFixed(2).replace(".", ",")}`;
}
