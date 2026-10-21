// Pede ao GitHub uma execução de publicar.yml com tarefa=edicao. Não decide nada: a cozinha é que
// sabe se a edição de hoje já saiu (slot-already-published) e, nesse caso, não faz nada. Por isso
// os dois horários do cron e o cron de reserva do próprio GitHub podem disparar sem medo.

interface Env {
  GITHUB_TOKEN: string;
}

// Só o que este arquivo usa do evento agendado; evita depender de @cloudflare/workers-types.
interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

const DISPATCH_URL =
  "https://api.github.com/repos/profdorly/pulso/actions/workflows/publicar.yml/dispatches";
const ATTEMPTS = 3;
const BACKOFF_MS = [0, 5_000, 20_000];
const TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function dispatch(env: Env, cron: string): Promise<void> {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN ausente: rode `wrangler secret put GITHUB_TOKEN`");

  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await sleep(BACKOFF_MS[attempt - 1] ?? 0);
    try {
      const res = await fetch(DISPATCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "pulso-disparador",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main", inputs: { tarefa: "edicao" } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 204) {
        console.log(`publicar.yml disparado (cron "${cron}", tentativa ${attempt})`);
        return;
      }
      // A mensagem de erro do GitHub não traz o token; o corte só evita log gigante.
      const body = (await res.text()).slice(0, 300);
      lastError = `HTTP ${res.status}: ${body}`;
      // 401, 403, 404, 422: token, permissão ou workflow errado. Tentar de novo não resolve.
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    console.error(`tentativa ${attempt} de ${ATTEMPTS} falhou (cron "${cron}"): ${lastError}`);
  }
  throw new Error(`publicar.yml não foi disparado (cron "${cron}"): ${lastError}`);
}

export default {
  // Esperamos o disparo aqui mesmo, sem ctx.waitUntil: assim uma falha final faz a invocação
  // terminar em erro nos logs da Cloudflare. A espera da rede não conta no limite de CPU.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await dispatch(env, controller.cron);
  },
};
