// Pede ao GitHub uma execução de publicar.yml com tarefa=edicao, mas só quando ela faz falta: antes
// de disparar, olha o site no ar. Se a capa já mostra a edição de hoje, não há o que fazer e nada é
// disparado. Assim um dia normal tem uma corrida (a das 07:32), e os horários das 09:05 e das 17:15
// são tentativas de verdade, que só rodam se a edição ainda não saiu.
//
// Menos corridas é menos exposição ao GitHub: em 29/10/2026 uma corrida ficou presa antes do
// primeiro job e, porque as corridas andavam numa fila única, segurou todas as seguintes e o dia
// 30/10 ficou sem edição. A fila única acabou (publicar.yml); com este filtro, uma corrida presa
// custa só o próprio horário, e a tentativa seguinte roda.

interface Env {
  GITHUB_TOKEN: string;
}

// Só o que este arquivo usa do evento agendado; evita depender de @cloudflare/workers-types.
interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

const WORKFLOW_URL = "https://api.github.com/repos/profdorly/pulso/actions/workflows/publicar.yml";
const DISPATCH_URL = `${WORKFLOW_URL}/dispatches`;
const SITE = "https://pulso.dorly.com.br";
const ATTEMPTS = 3;
const BACKOFF_MS = [0, 5_000, 20_000];
const TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function headers(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pulso-disparador",
  };
}

/** The edition the kitchen makes on `now`'s day in Brasília: `2026-10-31-manha`. */
export function todayEditionId(now: number): string {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(now));
  return `${date}-manha`;
}

/**
 * The edition the live cover shows (the `pulso:edition` marker the prerender writes), or null when
 * the site cannot be read. Unreadable counts as "not live": dispatching for nothing costs a minute
 * of a free runner; not dispatching could cost the day.
 */
export async function liveEdition(now: number): Promise<string | null> {
  try {
    // The query string goes past the CDN's copy, so a deploy of minutes ago is what is seen.
    const res = await fetch(`${SITE}/?disparador=${now}`, {
      headers: { "Cache-Control": "no-cache", "User-Agent": "pulso-disparador" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return /<meta name="pulso:edition" content="([^"]+)"/.exec(await res.text())?.[1] ?? null;
  } catch (err) {
    console.error(`não deu para ler o site no ar: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// O GitHub desliga o workflow de um repositório público após 60 dias sem atividade
// (`disabled_inactivity`), e aí o dispatch também falha. O passo "Manter o agendamento ativo" do
// próprio workflow só roda se uma execução rodar, então quem religa é o Worker. Um workflow
// desligado à mão (`disabled_manually`) continua desligado. Qualquer erro aqui só vai para o log:
// o dispatch logo abaixo é que diz se deu certo.
async function ensureActive(env: Env): Promise<void> {
  try {
    const res = await fetch(WORKFLOW_URL, { headers: headers(env), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao ler o estado do workflow`);
    const { state } = (await res.json()) as { state?: string };
    if (state !== "disabled_inactivity") return;
    const enable = await fetch(`${WORKFLOW_URL}/enable`, {
      method: "PUT",
      headers: headers(env),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!enable.ok) throw new Error(`HTTP ${enable.status} ao religar o workflow`);
    console.log("publicar.yml estava desligado por inatividade e foi religado");
  } catch (err) {
    console.error(`não deu para conferir se publicar.yml está ligado: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function dispatch(env: Env, cron: string): Promise<void> {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN ausente: rode `wrangler secret put GITHUB_TOKEN`");

  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await sleep(BACKOFF_MS[attempt - 1] ?? 0);
    try {
      const res = await fetch(DISPATCH_URL, {
        method: "POST",
        headers: { ...headers(env), "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: { tarefa: "edicao" } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 204 é a resposta clássica; com `return_run_details` (e, segundo relatos, às vezes sem
      // pedir) o GitHub responde 200. Os dois querem dizer que a execução foi criada.
      if (res.ok) {
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
    const expected = todayEditionId(controller.scheduledTime);
    const live = await liveEdition(controller.scheduledTime);
    if (live === expected) {
      console.log(`o site já mostra ${expected}; nada a disparar (cron "${controller.cron}")`);
      return;
    }
    console.log(`o site mostra ${live ?? "nada"}, esperado ${expected}; disparando`);
    if (env.GITHUB_TOKEN) await ensureActive(env);
    await dispatch(env, controller.cron);
  },
};
