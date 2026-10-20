# Pulso

Jornal diário de inteligência artificial em português, montado por um programa e publicado sem revisão humana no meio — por isso cada regra de seleção, escrita e checagem está no código, com teste. No ar em **[pulso.dorly.com.br](https://pulso.dorly.com.br/)**.

*A daily AI news journal in Brazilian Portuguese, written and fact-checked by a pipeline of models and deterministic gates, published as a static site. Runs entirely on GitHub Actions, GitHub Pages and a Cloudflare R2 bucket; the only paid part is the OpenAI API (about US$ 0.35 an edition).*

## O que ele faz

Todo dia às 07:30 (Brasília):

1. **Lê** 27 feeds de laboratórios e imprensa e busca na web o que eles não trouxeram.
2. **Escolhe** até 50 itens com cota por região e por veículo, para que a capa não seja só do país que publica mais.
3. **Abre cada link** e confere que a página existe, é a matéria certa e é da janela.
4. **Escreve** título, frase e resumo em português a partir do texto da página, não da manchete.
5. **Confere** o texto duas vezes: um gate determinístico casa número, preço, porcentagem e versão de modelo com a página; um modelo auditor diferente do que escreveu procura o resto (atribuição, tempo verbal, exagero) e derruba só o trecho que não se sustenta.
6. **Publica** a edição, a capa e o feed RSS. Às segundas, antes da edição, atualiza o [catálogo de modelos](https://pulso.dorly.com.br/modelos/) com os números da Artificial Analysis.

O porquê de cada regra está em [docs/como-funciona.md](docs/como-funciona.md); a versão para o leitor, na [metodologia](https://pulso.dorly.com.br/metodologia/); as medições, em [research/](research/).

## Como roda

```
            GitHub Actions (publicar.yml)
  07:30 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
 ──────▶│   cozinha    │──▶│     site     │──▶│    deploy    │──▶ GitHub Pages
        │ npm run      │   │ kitchen:     │   │ deploy-pages │    pulso.dorly.com.br
        │ kitchen      │   │ export +     │   └──────────────┘
        └──────┬───────┘   │ build:site   │
               │           └──────┬───────┘
        baixa / devolve        lê │
               ▼                  ▼
        ┌──────────────────────────────┐
        │ Cloudflare R2: pulso-cozinha │  news.db (itens, snapshots e as edições),
        │                              │  backups/ (30 dias), weekly/ (áudio)
        └──────────────────────────────┘
```

- **Cozinha** (`backend/`): TypeScript, SQLite (`better-sqlite3`), OpenAI Responses API. O estado inteiro é um arquivo, baixado e devolvido com escrita condicional: duas corridas nunca se sobrescrevem, e uma corrida que falha não muda nada.
- **Site** (`frontend/`, `scripts/`): React pré-renderizado em HTML estático. Sem JavaScript nas páginas, exceto o player do Pulso da Semana e o Google Analytics.
- **Duas corridas por dia**: a das 07:30 faz o trabalho; a das 09:40 refaz só o que faltou (a edição, se não saiu; o site, se não mostra a edição) e de resto não gasta nada.
- **Monitoramento**: o [Healthchecks.io](https://healthchecks.io/) recebe sucesso só quando o site **no ar** mostra a edição do dia, conferido depois do deploy. Sem ping em um dia, ele avisa — o que cobre corrida que falhou, deploy que falhou e agendamento que o GitHub descartou. Um segundo monitor, opcional, cobre o catálogo semanal. A própria corrida reativa o agendamento, que o GitHub desligaria após 60 dias sem commit.

## Rodar local

Node 24.

```bash
npm ci
npm run dev                 # http://localhost:4311/ com as edições de exemplo (fixtures/editions)
```

Uma edição de verdade precisa de chave da OpenAI em `backend/.env` (modelo em `backend/.env.example`):

```bash
npm run edition -- --slot=manha     # grava data/editions/
npm run edition -- --benchmarks     # catálogo de modelos (precisa de ARTIFICIAL_ANALYSIS_API_KEY)
npm run build:site                  # monta dist-site/ a partir de data/editions
npm run verify:site                 # sobe o site local e confere rotas, metadados e feeds
```

O Pulso da Semana é gerado à mão (`backend/src/weekly/pilot.ts`, sobre as edições de `npm run kitchen:export`) e publicado com:

```bash
npm run kitchen:weekly -- --from .tmp/weekly-audio-pilot/2026-W43   # envia o episódio e soma ao índice
```

Testes e checagens, os mesmos do CI:

```bash
npm run typecheck && npm run lint && npm test
npm run build:site && npm run verify:site && npm run budget:bundle && npm run a11y
```

## Publicar o seu

1. Crie um bucket R2 e dois tokens restritos a ele: um de leitura e escrita (a cozinha) e um só de leitura (o site).
2. No repositório, crie o ambiente `production` (Settings → Environments), com **Deployment branches** restrito a `main` — é isso que impede código de outro branch de ler os segredos. Segredos: `OPENAI_API_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY` (o token de escrita), `R2_READ_ACCESS_KEY_ID` e `R2_READ_SECRET_ACCESS_KEY` (o de leitura). Opcionais: `HEALTHCHECKS_URL` (período de 1 dia, tolerância de 4 h) e `HEALTHCHECKS_MODELOS_URL` (7 dias, tolerância de 2 dias). Variáveis opcionais: `PULSO_WEB_SEARCH=shadow` e `PULSO_MAX_EDITION_USD`.
3. Em Settings → Pages, escolha **GitHub Actions** como fonte.
4. Troque a identidade do jornal (nome, domínio, logo, Analytics): a lista está em [TRADEMARKS.md](TRADEMARKS.md).
5. Crie a variável de repositório `PULSO_PUBLICAR` com valor `true` (Settings → Secrets and variables → Actions → Variables). Sem ela, o workflow de publicação não roda nada — é o que deixa um fork inerte.
6. Rode o workflow **Publicar** à mão com `tarefa: edicao` e **iniciar** marcado. Só essa primeira corrida pode começar de uma cozinha vazia; depois disso, uma cozinha sumida é erro, não recomeço.

## Licença e marca

Código sob [Apache License 2.0](LICENSE). Os nomes **Pulso** e **Professor Dorly**, os logos e o visual do jornal não estão incluídos na licença: veja [TRADEMARKS.md](TRADEMARKS.md). Fontes sob SIL OFL 1.1. Os dados de modelos são da [Artificial Analysis](https://artificialanalysis.ai/), sob os termos dela.

Falhas de segurança: [SECURITY.md](SECURITY.md). Contribuições: [CONTRIBUTING.md](CONTRIBUTING.md).
