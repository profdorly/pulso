/**
 * Each source of the panel ends in one of three states, and one broken source never stops the
 * others: the page shows what it could read and says why the rest is missing.
 */
export type Source<T> =
  | { state: "ok"; data: T }
  /** Not configured: the setting names to fill in `.env.health`. */
  | { state: "missing"; missing: string[] }
  | { state: "error"; message: string };

export type Fetch = typeof fetch;

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_MESSAGE = 300;

/** Replaces every credential value in `text`; the page and the console only ever see the result. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 6) out = out.split(secret).join("•••");
  }
  return out;
}

export async function collect<T>(
  missing: string[],
  secrets: readonly string[],
  read: () => Promise<T>
): Promise<Source<T>> {
  if (missing.length > 0) return { state: "missing", missing };
  try {
    return { state: "ok", data: await read() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: "error", message: redact(message, secrets).slice(0, MAX_MESSAGE) };
  }
}

/**
 * GET or POST that throws a short, body-free message on failure. The response body is left out
 * on purpose: some APIs echo the request, and the request carries the key.
 */
export async function request(fetchImpl: Fetch, label: string, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? " (chave inválida ou sem permissão)"
        : response.status === 429
          ? " (limite de requisições; tente de novo em um minuto)"
          : "";
    throw new Error(`${label} respondeu HTTP ${response.status}${hint}`);
  }
  return response;
}

/** Runs `task` over `items`, `limit` at a time, keeping order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
