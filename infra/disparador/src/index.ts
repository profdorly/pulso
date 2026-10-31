// Pede ao GitHub uma execução de publicar.yml com tarefa=edicao. Não decide nada: a cozinha é que
// sabe se a edição de hoje já saiu (slot-already-published) e, nesse caso, só confere se o site no
// ar a mostra e republica se preciso. Por isso os três horários do cron e o cron de reserva do
// próprio GitHub podem disparar sem medo. O das 17:15 de Brasília é o herdeiro do `pulso-site-tarde`
// da AWS: um dia em que as corridas da manhã falharam é retomado à tarde, não no dia seguinte.

interface Env {
  GITHUB_TOKEN: string;
}

// Só o que este arquivo usa do evento agendado; evita depender de @cloudflare/workers-types.
interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

const REPO_URL = "https://api.github.com/repos/profdorly/pulso";
const WORKFLOW_URL = `${REPO_URL}/actions/workflows/publicar.yml`;
const DISPATCH_URL = `${WORKFLOW_URL}/dispatches`;
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

async function dispatch(env: Env, cron: string, fila?: string): Promise<void> {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN ausente: rode `wrangler secret put GITHUB_TOKEN`");

  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await sleep(BACKOFF_MS[attempt - 1] ?? 0);
    try {
      const res = await fetch(DISPATCH_URL, {
        method: "POST",
        headers: { ...headers(env), "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: { tarefa: "edicao", ...(fila ? { fila } : {}) } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 204 é a resposta clássica; com `return_run_details` (e, segundo relatos, às vezes sem
      // pedir) o GitHub responde 200. Os dois querem dizer que a execução foi criada.
      if (res.ok) {
        console.log(`publicar.yml disparado (cron "${cron}", tentativa ${attempt}${fila ? `, fila ${fila}` : ""})`);
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

// Uma corrida normal sai de "waiting" em segundos: o ambiente `production` não tem aprovador nem
// espera. Parada assim há mais que isto, o GitHub a perdeu (29/10/2026: 30 horas, um dia sem
// edição) e ela segura a fila do workflow para sempre, sem aceitar cancelamento.
const STUCK_AFTER_MS = 40 * 60_000;

interface RunSummary {
  id: number;
  status: string;
  created_at: string;
}

async function runsWithStatus(env: Env, status: "waiting" | "pending" | "in_progress"): Promise<RunSummary[]> {
  const res = await fetch(`${WORKFLOW_URL}/runs?status=${status}&per_page=50`, {
    headers: headers(env),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao listar corridas ${status}`);
  return ((await res.json()) as { workflow_runs?: RunSummary[] }).workflow_runs ?? [];
}

async function cancelRun(env: Env, id: number): Promise<boolean> {
  const res = await fetch(`${REPO_URL}/actions/runs/${id}/cancel`, {
    method: "POST",
    headers: headers(env),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.ok;
}

/**
 * Procura uma corrida presa e devolve a fila de desvio para o disparo, ou nada se a fila andar.
 *
 * Primeiro tenta cancelar a corrida presa; quando o GitHub aceita, a fila volta a andar e não há
 * desvio. Quando recusa (o caso de 29/10), o disparo vai para `desvio-<id da presa>`: todas as
 * corridas do Worker durante o mesmo problema caem nessa fila e continuam uma por vez. As que
 * ficaram paradas atrás da presa são canceladas, porque nunca vão rodar e só confundem o painel.
 * Qualquer erro aqui vai para o log e o disparo segue na fila normal.
 */
export async function unstick(env: Env, now = Date.now()): Promise<string | undefined> {
  try {
    const stuck = (await runsWithStatus(env, "waiting")).filter((run) => now - Date.parse(run.created_at) > STUCK_AFTER_MS);
    if (stuck.length === 0) return undefined;
    const oldest = stuck.reduce((a, b) => (Date.parse(a.created_at) <= Date.parse(b.created_at) ? a : b));
    console.error(`corrida ${oldest.id} presa em "waiting" desde ${oldest.created_at}`);

    const freed = await Promise.all(stuck.map((run) => cancelRun(env, run.id)));
    // Só sem corrida rodando: uma parada atrás de uma que está trabalhando apenas espera a vez.
    if ((await runsWithStatus(env, "in_progress")).length === 0) {
      for (const run of (await runsWithStatus(env, "pending")).filter((r) => now - Date.parse(r.created_at) > STUCK_AFTER_MS)) {
        if (await cancelRun(env, run.id)) console.log(`corrida ${run.id}, parada na fila atrás da presa, cancelada`);
      }
    }
    if (freed.every(Boolean)) {
      console.log("a corrida presa aceitou o cancelamento; a fila normal volta a andar");
      return undefined;
    }
    console.error(`o GitHub recusou cancelar a corrida ${oldest.id}; disparando numa fila de desvio`);
    return `desvio-${oldest.id}`;
  } catch (err) {
    console.error(`não deu para conferir corridas presas: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

export default {
  // Esperamos o disparo aqui mesmo, sem ctx.waitUntil: assim uma falha final faz a invocação
  // terminar em erro nos logs da Cloudflare. A espera da rede não conta no limite de CPU.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (!env.GITHUB_TOKEN) return dispatch(env, controller.cron);
    await ensureActive(env);
    await dispatch(env, controller.cron, await unstick(env));
  },
};
