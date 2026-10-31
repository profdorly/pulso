# Instruções para agentes de IA

O Pulso é um jornal diário de IA em português (`backend/` gera as edições, `frontend/` e `scripts/` montam o site estático). A visão geral está no [README](README.md) e os detalhes em [docs/como-funciona.md](docs/como-funciona.md). Todo texto em português para o leitor segue `.cursor/skills/pulso-copy/SKILL.md`.

## Pulso da Semana: guiar a publicação de segunda-feira

Quando a pessoa pedir para fazer o Pulso da Semana, siga [docs/pulso-da-semana.md](docs/pulso-da-semana.md). O fluxo é um comando por etapa: `npm run semana -- <etapa>`. Comece sempre por `npm run semana -- status`, que diz onde a semana está e qual é o próximo passo.

### Roteiro da conversa

1. Rode `status`. Se faltar, rode `preparar` e conte quantos dias da semana têm edição.
2. Rode `roteiro`. Leva de 3 a 5 minutos.
3. Mostre na conversa o **conteúdo inteiro** de `script.txt`, sem resumir. Antes dele, diga o título, o formato, a duração estimada (caracteres ÷ 15 ÷ 1,15 segundos) e o custo da etapa, que o comando imprime.
4. Pergunte se a pessoa aprova ou quer ajustes.
   - **Ajuste de texto**: edite só o campo `text` das falas em `script.json`, mantendo `speaker`, a alternância das vozes e as `refs`. Rode `checar` e mostre de novo as falas que mudaram.
   - **Outro ângulo ou outras histórias**: avise que custa cerca de US$ 0,35 e, com o ok, rode `roteiro --refazer`.
5. Só depois de uma aprovação explícita da versão atual ("aprovado", "pode gerar o áudio"), rode `aprovar` e em seguida `audio`.
6. Diga a duração e o resultado da verificação. Abra o MP3 (`open <caminho>` no macOS) e pergunte se pode publicar.
7. Com o ok, rode `publicar`. Acompanhe com `gh run watch` e confirme que `https://pulso.dorly.com.br/semana/<semana>/` mostra o episódio.

### Regras

- **Nunca** rode `aprovar` sem a aprovação explícita da pessoa, nesta conversa, para a versão atual do roteiro. Uma edição feita depois de um "aprovado" pede nova aprovação.
- **Nunca** edite `approval.json`, `script-status.json`, `audio-status.json` nem os hashes, e nunca contorne as travas do `semana.ts`. Elas existem para que o áudio só saia de um texto que alguém leu.
- **Nunca** acrescente ao roteiro um fato, número, nome ou relação de causa que não esteja nas matérias citadas (`weekly-input.json`). Toda edição passa por `checar`.
- Não use `--forcar`, `--refazer` ou `--max-creditos` maior sem pedir. Não rode `audio` uma segunda vez sem pedir: cada geração gasta créditos da ElevenLabs.
- Se um comando falhar, mostre a mensagem e a saída da tabela "Quando algo dá errado" do manual. Não improvise outro caminho.
- Não faça commit de nada em `.tmp/`, `data/`, `.env*` nem `backend/.env`.

## Checagens do repositório

Antes de propor mudança de código, rode as mesmas checagens do CI:

```bash
npm run typecheck && npm run lint && npm test
npm run build:site && npm run verify:site && npm run budget:bundle && npm run a11y
```
