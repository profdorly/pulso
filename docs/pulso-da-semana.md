# Pulso da Semana

Episódio em áudio, toda segunda-feira, sobre a semana em IA. Uma conversa entre duas vozes sintéticas (Paulo, o apresentador, e Roberta, a especialista), feita só com o que as edições da semana publicaram.

Este documento é o manual de operação. Ele serve a quem dispara o episódio e ao agente de IA que guia essa pessoa. As regras para o agente estão resumidas em [AGENTS.md](../AGENTS.md).

## O produto

| | |
|---|---|
| Quando sai | Segunda-feira de manhã, disparado à mão |
| O que cobre | A semana anterior, de segunda a domingo (semana ISO, como `2026-W44`) |
| Duração | No máximo 5 minutos no arquivo publicado |
| Velocidade | Gerado no ritmo natural das vozes e acelerado 1,15× na montagem, sem mudar o tom. A velocidade vem no próprio MP3, então vale também fora do site |
| Formato | Abertura com aviso de vozes sintéticas, de 3 a 4 blocos, fecho curto. De 4 a 7 histórias |
| Onde fica | `pulso.dorly.com.br/semana/`, com a lista de todos os episódios. Cada episódio fica em `/semana/<semana>/`, com player, transcrição sincronizada e matérias citadas. O episódio mais recente também aparece num card na capa |
| Custo por episódio | Texto, cerca de US$ 0,35 (OpenAI). Voz, cerca de 5 mil créditos da ElevenLabs. O plano Creator tem 121 mil por mês |

Os números estão no código, num só lugar cada:
- velocidade e duração máxima: `backend/src/weekly/episodeFormat.ts`;
- tamanho do roteiro: `SCRIPT_LIMITS` em `backend/src/weekly/gate.ts`;
- instruções do editor, do roteirista e do diretor de voz: `backend/src/weekly/narrative.ts`.

## Como o episódio é feito

1. **`preparar`**: baixa as edições da cozinha (R2) para `data/editions`.
2. **`roteiro`**: um editor escolhe as histórias e o desenho da semana, um roteirista escreve a conversa e um diretor de voz deixa a fala solta. Depois o roteiro passa por duas checagens. O gate é determinístico e confere números, tamanho, tags, alternância das vozes e o aviso de vozes sintéticas. O auditor de fidelidade compara cada fala com as matérias citadas. Se a auditoria apontar algo, há uma única revisão automática e as checagens rodam de novo.
3. **Leitura humana**: a pessoa responsável lê `script.txt`. Ela pode pedir ajustes, que entram em `script.json` e passam pelas checagens de novo (`checar`).
4. **`aprovar`**: registra a aprovação daquela versão exata do roteiro, pelo hash do arquivo.
5. **`audio`**: gera as vozes na ElevenLabs, monta, normaliza o volume, acelera para 1,15× e transcreve o áudio para comparar com o roteiro.
6. **Escuta**: a pessoa ouve o MP3. Recomendado, não obrigatório.
7. **`publicar`**: envia o episódio ao R2 e pede ao GitHub uma nova publicação do site. Em cerca de 3 minutos o episódio está no ar.

### As travas, que valem para qualquer operador

- `audio` não roda sem `aprovar`, e a aprovação vale só para o `script.json` que foi aprovado. Qualquer edição posterior, mesmo de uma vírgula, exige `checar` e `aprovar` de novo.
- `aprovar` não roda se o roteiro não passou nas checagens, ou se mudou depois delas.
- `publicar` recusa um áudio gerado de outra versão do roteiro e um episódio acima de 5 minutos. Para passar por cima, só com `--forcar`, e só se a pessoa responsável pedir.
- `audio` para antes da primeira chamada se o roteiro custar mais que o teto de créditos (`--max-creditos`, padrão 6.500).

## Toda segunda-feira

Tempo total: de 20 a 30 minutos, quase todo de leitura e escuta.

```bash
npm run semana -- status      # onde a semana está e qual é o próximo passo
npm run semana -- preparar    # baixa as edições
npm run semana -- roteiro     # 3 a 5 minutos; escreve .tmp/weekly-audio-pilot/<semana>/script.txt
#   ler script.txt; ajustes → editar script.json → npm run semana -- checar
npm run semana -- aprovar     # só depois da leitura e do "aprovado"
npm run semana -- audio       # 2 a 4 minutos; diz onde está o MP3
#   ouvir o MP3
npm run semana -- publicar    # envia e publica; confira /semana/<semana>/
```

Sem `--inicio`, todos os comandos usam a última semana completa. Numa segunda, é a que terminou no domingo. Para outra semana, use `--inicio AAAA-MM-DD` com a data da segunda-feira em que ela começa.

### Ajustar o roteiro

O roteiro fica em `.tmp/weekly-audio-pilot/<semana>/script.json`. Cada fala tem `speaker` (`host` ou `analyst`), `text` e `refs` (as histórias de onde o fato veio, como `s12`).

- Só o `text` deve mudar. Mantenha a alternância entre as vozes e as `refs` de cada fato.
- Nenhum fato pode entrar se não estiver nas matérias citadas. A auditoria vai apontar.
- Depois de editar, rode `npm run semana -- checar`. Com `--revisar`, as falas apontadas recebem uma revisão automática.
- Para mudar a escolha das histórias ou o ângulo da semana, rode `roteiro --refazer`. Isso gera outro roteiro do zero, custa de novo (cerca de US$ 0,35) e descarta a aprovação.

### Corrigir um episódio já publicado

Edite `script.json`, depois rode `checar`, `aprovar`, `audio` e `publicar`. A nova versão substitui a da mesma semana, e o MP3 antigo é apagado do R2. Gerar o áudio de novo custa os créditos de novo, porque só blocos idênticos são reaproveitados.

## Preparação única

Feita uma vez em cada computador.

1. **Programas**: Node 24, `npm ci` na raiz, `ffmpeg` (`brew install ffmpeg`) e o GitHub CLI autenticado (`gh auth login`), que dispara a publicação do site.
2. **`backend/.env`** (o git ignora este arquivo), com:
   - `OPENAI_API_KEY`;
   - `PULSO_AUDITOR_PROVIDER=openai` e `PULSO_AUDITOR_MODEL=gpt-6.1-sol`;
   - as credenciais do R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY`. Elas vêm de um token da Cloudflare em R2 → Manage API tokens, com permissão **Object Read & Write** restrita ao bucket `pulso-cozinha`. O token precisa ler `news.db` e `weekly/` e escrever em `weekly/`. Ele também poderia sobrescrever `news.db`, mas os comandos do semanal nunca escrevem nesse arquivo, e as cópias diárias em `backups/` ficam travadas por 25 dias.
3. **`.env.local`** (também ignorado), com `ELEVENLABS_API_KEY`. O plano em uso é o Creator. O uso além do limite está desligado, então uma geração que estoure o saldo falha em vez de cobrar.
4. **Código no `main`**: a página `/semana/` e o link no menu precisam estar no branch `main`, porque é dele que o GitHub monta o site.

## Arquivos de cada semana

Tudo fica em `.tmp/weekly-audio-pilot/<semana>/`, fora do git:

| Arquivo | O que é |
|---|---|
| `weekly-input.json` | As histórias da semana, como as edições publicaram |
| `outline.json` | A decisão do editor: formato, título, blocos |
| `script.json` / `script.txt` | O roteiro (o JSON é o que vale; o TXT é para ler) |
| `script-status.json` | Resultado das checagens e o hash do roteiro checado |
| `gate-*.json` / `audit-*.json` | Cada rodada de checagem |
| `approval.json` | Quem aprovou, quando e qual versão |
| `chunks/` | Os trechos gerados pela ElevenLabs, reaproveitados se o texto for idêntico |
| `public/weekly/` | O que vai para o site: `episode.json` e o MP3 |
| `audio-report.json` / `verify.json` | Duração, volume e a comparação entre áudio e roteiro |
| `calls.json` / `credits.json` | Custo: chamadas de modelo em US$ e créditos de voz |
| `published.json` | Quando foi publicado |

No R2, os episódios publicados ficam no prefixo `weekly/` do bucket `pulso-cozinha`, ao lado da cozinha. O `weekly/index.json` lista todos, e o site é montado a partir dele.

## Quando algo dá errado

| Mensagem | O que fazer |
|---|---|
| `credenciais do R2 ausentes` | Preencher `backend/.env` (Preparação única, passo 2) |
| `nenhuma edição de … a …` | Rodar `preparar`; conferir `--inicio` |
| `roteiro REPROVADO nas checagens` | Ler os apontamentos; editar `script.json` e rodar `checar`, ou `checar --revisar`, ou `roteiro --refazer` |
| `auditor indisponível` | Conferir `PULSO_AUDITOR_*` e `OPENAI_API_KEY` |
| `o roteiro custaria N créditos, acima do teto` | O roteiro está longo demais; encurtar e rodar `checar` |
| `ElevenLabs … 401/402/429` | Chave, saldo ou limite de uso; ver o painel da ElevenLabs |
| `ffmpeg: command not found` | `brew install ffmpeg` |
| `acima de 5 min` | Encurtar o roteiro: `checar`, `aprovar`, `audio` |
| O episódio não aparece no site | `gh run list --workflow publicar.yml` e `gh run watch`; se preciso, `gh workflow run publicar.yml -f tarefa=site` |

## Ainda não feito

- **Busca e apps de podcast**: as páginas de episódio continuam `noindex`, porque a transcrição só aparece no navegador e um robô de busca veria a página vazia. O próximo passo é renderizar a transcrição no HTML. Depois vem um `/podcast.xml` separado do `feed.xml`, para Spotify e Apple, quando houver algumas semanas no ar.
- **Monitoramento**: não há check no Healthchecks para o semanal. Como o disparo é manual, quem opera sabe se saiu.
- **Hospedagem do áudio**: o MP3 vai junto com o site no GitHub Pages, que tem limite de 1 GB por site. Com cerca de 3,5 MB por episódio, isso dura anos. Se crescer, o áudio vai para um bucket R2 público, e o `media-src` da CSP muda junto.
