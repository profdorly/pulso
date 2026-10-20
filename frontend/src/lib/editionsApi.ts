import type { PulsoEdition, PulsoIndex } from "./edition.js";
import { editionsUrl } from "./paths.js";

export class EditionNotFoundError extends Error {
  constructor(url: string) {
    super(`Edição não encontrada (${url})`);
    this.name = "EditionNotFoundError";
  }
}

export async function fetchJson<T>(path: string, parse: (data: unknown) => T): Promise<T> {
  const response = await fetch(path);
  if (response.status === 404) {
    throw new EditionNotFoundError(path);
  }
  if (!response.ok) {
    throw new Error(`Não foi possível ler ${path} (${response.status})`);
  }
  return parse(await response.json());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseEdition(data: unknown): PulsoEdition {
  if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.digest) || !Array.isArray(data.items)) {
    throw new Error("Artefato de edição inválido");
  }
  return data as unknown as PulsoEdition;
}

export function parseIndex(data: unknown): PulsoIndex {
  if (!isRecord(data) || data.schemaVersion !== 1 || !Array.isArray(data.editions)) {
    throw new Error("Índice de edições inválido");
  }
  return data as unknown as PulsoIndex;
}

export function fetchLatestEdition(): Promise<PulsoEdition> {
  return fetchJson(editionsUrl("latest.json"), parseEdition);
}

export function fetchEdition(calendarDate: string, slot: string): Promise<PulsoEdition> {
  return fetchJson(editionsUrl(`${calendarDate}/${slot}.json`), parseEdition);
}

export function fetchEditionIndex(): Promise<PulsoIndex> {
  return fetchJson(editionsUrl("index.json"), parseIndex);
}
