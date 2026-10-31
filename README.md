# Pulso

[![CI](https://github.com/profdorly/pulso/actions/workflows/ci.yml/badge.svg)](https://github.com/profdorly/pulso/actions/workflows/ci.yml)
[![Licença: Apache 2.0](https://img.shields.io/badge/licen%C3%A7a-Apache%202.0-blue)](LICENSE)
· [English](README.en.md)

Jornal diário de inteligência artificial em português, montado por um programa e publicado sem revisão humana no meio. Por isso cada regra de seleção, escrita e checagem está no código, com teste. No ar em **[pulso.dorly.com.br](https://pulso.dorly.com.br/)**.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/capa-escuro.webp">
  <img src="docs/img/capa-claro.webp" alt="Capa do Pulso #106, de 24 de outubro de 2026: manchete sobre a OpenAI cortar a internet no treinamento de modelos de ponta, com o ranking de modelos ao lado.">
</picture>

## Por que existe

Notícia de IA sai primeiro lá fora, e o veículo brasileiro que traduz leva dias, quando traduz. O Pulso lê as fontes direto e entrega o resumo em português todo dia às 07:30. Como não há editor revisando antes de publicar, a regra editorial não pode depender do bom senso de ninguém: ela está escrita no código, e o teste diz se ela ainda vale.

## O que tem no site

- **Capa e edição do dia**: o resumo da manhã, as prioridades e o radar, separado em imprensa e anúncios direto dos labs. O título de cada item leva à fonte; o resumo em português abre na própria edição.
- **[Arquivo](https://pulso.dorly.com.br/arquivo/)** de todas as edições, cada uma com uma capa 16:9 desenhada pelo programa.
- **[Modelos](https://pulso.dorly.com.br/modelos/)**: catálogo semanal com os números da Artificial Analysis. Responde qual é o mais inteligente, o mais rápido, o mais barato e quem está na fronteira de preço × inteligência.
- **Pulso da Semana**: a semana em áudio, por enquanto gerado à mão.
- **[RSS](https://pulso.dorly.com.br/feed.xml)** e **[metodologia](https://pulso.dorly.com.br/metodologia/)**, a versão para o leitor do que este README explica.

<p>
  <img src="docs/img/edicao.webp" width="49%" alt="Item da edição: veículo e região (TechCrunch, EUA), título em português, frase de resumo e o resumo de dois parágrafos aberto.">
  <img src="docs/img/modelos.webp" width="49%" alt="Gráfico de preço por inteligência da página de modelos, com uma linha ligando os modelos da fronteira de custo-benefício, de MiMo-V2.6-Flash a Claude Opus 5.5.">
</p>

<img src="docs/img/capas.webp" alt="Capas 16:9 das edições de 21 a 24 de outubro de 2026, todas geradas pela cozinha.">

## Como sai uma edição

<img src="docs/img/como-funciona.png" alt="Os seis passos de uma edição (lê, escolhe, abre cada link, escreve, confere, publica) com os números da edição #106: 27 feeds, até 50 itens, 44 publicados por US$ 0,47. Embaixo, a origem das 44 notícias: EUA 15, Ásia 11, Europa 10, Brasil 8.">

Todo dia por volta das 07:30 (Brasília):

1. **Lê** 27 feeds, 8 de laboratórios e 19 de imprensa dos EUA, da Europa, da Ásia e do Brasil. A janela vai da capa anterior até a corrida, umas 24 horas.
2. **Escolhe** até 50 itens. Anúncio de lab entra sem cota, porque o anúncio é o fato. A imprensa divide as vagas por região, com no máximo três itens por veículo. Quando a seleção era por recência, a capa saía inteiramente brasileira: veículo daqui publica mais e mais perto da hora da corrida.
3. **Abre cada link** e confere que a página existe, é a matéria certa e saiu dentro da janela.
4. **Escreve** título, frase e resumo em português a partir do texto da página, não da manchete.
5. **Confere** o texto duas vezes, como mostra a próxima seção.
6. **Publica** a edição, a capa e o feed RSS. Às segundas, antes da edição, atualiza o catálogo de modelos.

Uma busca na web por região roda em teste ao lado dos feeds: ela registra o que traria de novo, sem publicar nada ainda.

O porquê de cada regra está em [docs/como-funciona.md](docs/como-funciona.md); as medições que embasam as decisões, em [research/](research/).

## O que é conferido, e o que não é

<img src="docs/img/checagem.png" alt="Exemplo de checagem com um caso de teste: a frase diz 40 dólares onde a matéria diz 4 e o gate determinístico a derruba; o resumo diz que o modelo foi lançado onde a matéria fala em lista de espera, e o auditor o derruba. O item continua com título e link.">

- **Sem modelo**, um gate casa dinheiro, porcentagem, número preciso e versão de modelo com a página. Frase ou resumo com número que a página não sustenta sai. Manchete ou abertura da capa sem suporte voltam a um texto montado só com os títulos das fontes. O gate não custa nada e não tem como ser convencido do contrário.
- **Com um modelo diferente do que escreveu**, o auditor procura o resto: fala atribuída à pessoa errada, "planeja lançar" virando "lançou", exagero. Ele dá um veredito por item, cita o trecho exato e derruba só o campo onde o trecho está. Revisão é uma só, nunca um laço, e volta pelo gate antes de ser aceita. Veredito ilegível derruba todo o texto gerado do item.
- **Não é conferido**: prosa, enquadramento e juízo editorial. Checar tudo custaria outra passada de modelo por item e rejeitaria muito mais do que pegaria.
- **Quando nada sobrevive**, a capa de ontem fica se tiver menos de 36 horas. Se for mais velha, sai uma edição silenciosa que diz o que foi checado e por que nada entrou.
- **Teto de gasto**: US$ 4 por corrida. Se a auditoria for pulada por custo, os resumos saem junto. O teto não vira atalho para publicar sem auditoria.

## Como roda

```mermaid
flowchart LR
    W["Worker da Cloudflare<br/>07:32 · 09:05 · 17:15"] --> A["GitHub Actions<br/>publicar.yml"]
    G["cron do GitHub<br/>07:27 · 17:10, de reserva"] -.-> A
    A <-->|"baixa e devolve news.db<br/>(escrita condicional)"| R[("Cloudflare R2<br/>pulso-cozinha")]
    A -->|deploy| P["GitHub Pages<br/>pulso.dorly.com.br"]
    A -->|"ping só se o site no ar<br/>mostra a edição"| H["Healthchecks.io"]
```

- **Cozinha** (`backend/`): TypeScript, SQLite (`better-sqlite3`), OpenAI Responses API. O estado inteiro é um arquivo, baixado no começo e devolvido no fim só se ninguém mexeu nele no meio: duas corridas nunca se sobrescrevem, e uma corrida que falha não muda nada. Cada envio deixa uma cópia em `backups/`, guardada 30 dias e travada contra apagamento nos primeiros 25.
- **Site** (`frontend/`, `scripts/`): React pré-renderizado em HTML estático. Sem JavaScript nas páginas, exceto o player do Pulso da Semana e o Google Analytics.
- **Agendamento**: o cron do GitHub atrasa horas, então quem dispara é um Worker da Cloudflare ([infra/disparador](infra/disparador/README.md)). A primeira corrida faz o trabalho; as outras só refazem o que faltou e de resto não gastam nada.
- **Monitoramento**: o Healthchecks.io avisa se um dia passar sem a edição no ar, seja qual for a etapa que falhou.

Horários, configuração do monitor e validade dos tokens: [docs/operacao.md](docs/operacao.md).

## Quanto custa

Só a API da OpenAI é paga: cerca de US$ 0,50 por edição (a de 24/10/2026, com 44 itens, custou US$ 0,47). GitHub Actions, GitHub Pages, o bucket R2, o Worker, o Healthchecks e a API da Artificial Analysis ficam no plano gratuito.

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

O Pulso da Semana é gerado à mão (`backend/src/weekly/pilot.ts`, sobre as edições de `npm run kitchen:export`), que grava o episódio em `.tmp/weekly-audio-pilot/<semana>/`. Para publicar:

```bash
npm run kitchen:weekly -- --from .tmp/weekly-audio-pilot/2026-W43   # envia o episódio e soma ao índice
```

Testes e checagens, os mesmos do CI:

```bash
npm run typecheck && npm run lint && npm test
npm run build:site && npm run verify:site && npm run budget:bundle && npm run a11y
```

As imagens deste README saem de `npm run docs:images`: os diagramas de `docs/img/src/` e capturas do site no ar, feitas com o Chrome instalado (`--base=http://localhost:4311` para o site local).

## Publicar o seu

1. Crie um bucket R2 e dois tokens restritos a ele: um de leitura e escrita (a cozinha) e um só de leitura (o site).
2. No repositório, crie o ambiente `production` (Settings → Environments), com **Deployment branches** restrito a `main`. É isso que impede código de outro branch de ler os segredos. Segredos: `OPENAI_API_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY` (o token de escrita), `R2_READ_ACCESS_KEY_ID` e `R2_READ_SECRET_ACCESS_KEY` (o de leitura). Opcionais: `HEALTHCHECKS_URL` e `HEALTHCHECKS_MODELOS_URL`, configurados como em [docs/operacao.md](docs/operacao.md#monitoramento). Depois de criar os segredos, rode o workflow **Testar chaves**. Variáveis opcionais: `PULSO_WEB_SEARCH=shadow` e `PULSO_MAX_EDITION_USD`.
3. Em Settings → Pages, escolha **GitHub Actions** como fonte.
4. Troque a identidade do jornal (nome, domínio, logo, Analytics): a lista está em [TRADEMARKS.md](TRADEMARKS.md).
5. Crie a variável de repositório `PULSO_PUBLICAR` com valor `true` (Settings → Secrets and variables → Actions → Variables). Sem ela, o workflow de publicação não roda nada, o que deixa um fork inerte.
6. Rode o workflow **Publicar** à mão com `tarefa: edicao` e **iniciar** marcado. Só essa primeira corrida pode começar de uma cozinha vazia; depois disso, uma cozinha sumida é erro, não recomeço.
7. Para não depender do cron do GitHub, suba o Worker de [infra/disparador](infra/disparador/README.md).

## Glossário

- **Cozinha**: o banco SQLite com os itens já vistos, os snapshots de benchmark e as edições. Mora num bucket R2 e vai e volta a cada corrida.
- **Corrida**: uma execução do workflow `publicar.yml`.
- **Gate de evidência**: a checagem sem modelo que casa números e versões com a página da fonte.
- **Auditor**: o modelo que lê o texto escrito por outro e aponta o que a matéria não sustenta.
- **Slot**: o horário da edição no código (`manha`). Hoje há um por dia.
- **Stub**: o texto da capa montado só com os títulos das fontes, usado quando o texto gerado não passa na checagem.
- **Edição silenciosa**: a edição que sai quando nada passou e a capa anterior tem mais de 36 horas. Diz o que foi checado em vez de deixar a home parada.

## Licença e marca

Código sob [Apache License 2.0](LICENSE). Os nomes **Pulso** e **Professor Dorly**, os logos e o visual do jornal não estão incluídos na licença: veja [TRADEMARKS.md](TRADEMARKS.md). As imagens de `docs/img/` mostram esse visual e seguem a mesma regra. Fontes sob SIL OFL 1.1. Os dados de modelos são da [Artificial Analysis](https://artificialanalysis.ai/), sob os termos dela.

Falhas de segurança: [SECURITY.md](SECURITY.md). Contribuições: [CONTRIBUTING.md](CONTRIBUTING.md).
