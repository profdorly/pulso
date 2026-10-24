# Segurança

## Como reportar

Use o relato privado do GitHub: aba **Security → Report a vulnerability** neste repositório. Não abra issue pública para falha de segurança.

Ajuda incluir o que você encontrou, como reproduzir e o impacto que você enxerga. Não há programa de recompensa nem prazo de resposta garantido: o Pulso é mantido por uma pessoa. Toda mensagem é lida.

## O que está no escopo

- O código deste repositório: a cozinha (`backend/`), o site (`frontend/`, `scripts/`) e os workflows (`.github/workflows/`).
- O site publicado em `pulso.dorly.com.br`, no que depende deste código.

Fora do escopo: os serviços de terceiros que o Pulso usa (GitHub, Cloudflare, OpenAI, Artificial Analysis, Google Analytics) e testes de carga ou negação de serviço contra o site.

## O que já é tratado

- **Conteúdo de terceiros é dado, não instrução.** Feeds, páginas e resultados de busca chegam aos modelos marcados como conteúdo externo, e as garantias ficam no código: URL que a busca não devolveu é descartada, item cuja URL não está na edição não entra.
- **Nenhum feed leva a cozinha a um endereço interno.** Toda URL passa por uma guarda de protocolo, host e IP resolvido, refeita a cada redirect (`backend/src/edition/safeFetch.ts`).
- **Segredos só no ambiente `production` do GitHub Actions**, restrito ao branch `main`, nunca no repositório. O CI de pull request não recebe segredo nenhum; os workflows fixam as actions por commit e não deixam o token do checkout no disco. O passo que monta o site lê a cozinha com um token só de leitura.
- **Dependência nenhuma roda código na instalação** dentro do GitHub Actions: os scripts de instalação são desligados e só os dois pacotes que compilam binário nativo (`better-sqlite3`, `esbuild`) são reconstruídos, conforme a lista `allowScripts` do `package.json`.
- **Segredos em commit são barrados duas vezes**: pela proteção de push do GitHub e por uma varredura com gitleaks no CI, que cobre também pull requests de fork e o histórico.
- **A cozinha só é sobrescrita pela versão que foi baixada** (escrita condicional no R2). Cada envio deixa uma cópia, que uma trava do bucket protege contra apagamento e sobrescrita por 25 dias, mesmo para quem tiver a chave da cozinha. Uma cozinha que sumiu é erro, não recomeço.
- **Chaves do R2 com o menor poder possível**: uma só lê e escreve objetos do bucket da cozinha (sem mexer na configuração dele, nem na trava), a outra só lê; as duas expiram em um ano.
- **O site é estático**: não há endpoint de escrita, formulário que grave dado nem login. Cada página declara uma Content Security Policy (`scripts/lib/csp.mjs`) que só deixa rodar o próprio site e o Google Analytics, e o leitor só transforma em link um endereço http(s).
- **O painel de saúde (`npm run health`) só lê** e roda só na máquina de quem o usa: as chaves são de leitura e ficam em `.env.health`, ignorado pelo git; a página gerada não tem script nem servidor. O relatório de custo que cada corrida guarda como artefato, visível para qualquer conta do GitHub, leva só números, etapas, modelos e status.
