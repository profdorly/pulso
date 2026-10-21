# Disparador

Um Worker da Cloudflare que, às 07:32 e às 09:05 de Brasília, pede ao GitHub uma execução de
`publicar.yml` com `tarefa=edicao`. É o gatilho principal da publicação diária. O `schedule` do
GitHub nunca disparou neste repositório e fica só como reserva, às 07:27.

O Worker não decide nada. Quem sabe se a edição de hoje já saiu é a cozinha: se saiu, ela responde
`slot-already-published` e para. Por isso disparos a mais não fazem mal.

Ele não tem rota, domínio nem endereço `*.workers.dev`. Só acorda pelo cron.

## Custo

Zero, no plano Workers Free. Dois disparos por dia usam uma fração mínima do limite (100 mil
requisições por dia, 10 ms de CPU por invocação; a espera pela rede não conta). O plano gratuito
recusa o que passa do limite, mas não cobra.

Antes de tudo, confira em Cloudflare → Workers & Pages → Plans que a conta está no **Free**, sem
o Workers Paid e sem cartão ligado a ele.

## Configurar (uma vez)

Os comandos rodam nesta pasta e usam a versão fixada do wrangler, sem instalar nada no projeto.

1. Crie um token *fine-grained* no GitHub (Settings → Developer settings → Personal access tokens
   → Fine-grained tokens):
   - Repository access: **Only select repositories** → `profdorly/pulso`
   - Permissions → Repository → **Actions: Read and write**. Nenhuma outra.
   - Expiration: 1 ano. Anote a data e ponha um lembrete para trocar o token antes dela.

2. Entre na Cloudflare:

   ```bash
   npx wrangler@4.151.3 login
   ```

3. Guarde o token como segredo do Worker (o comando pede o valor; não o cole em arquivo):

   ```bash
   npx wrangler@4.151.3 secret put GITHUB_TOKEN
   ```

4. Publique:

   ```bash
   npx wrangler@4.151.3 deploy
   ```

Para trocar o token, repita o passo 3. Não precisa publicar de novo.

## Testar na máquina

```bash
npx wrangler@4.151.3 dev --test-scheduled
# em outro terminal:
curl "http://localhost:8787/__scheduled?cron=32+10+*+*+*"
```

Atenção: o teste dispara `publicar.yml` de verdade. Não faz mal, porque a cozinha não refaz uma
edição que já saiu. Em local, o token vem de um arquivo `.dev.vars` nesta pasta
(`GITHUB_TOKEN=...`); ele está no `.gitignore` e não deve ir para o repositório.

Para conferir os tipos depois de mexer em `src/index.ts`:

```bash
npx -p typescript@5.9.3 tsc --noEmit --strict --noUncheckedIndexedAccess --target es2022 \
  --module esnext --moduleResolution bundler --lib es2022,dom src/index.ts
```

## Conferir se rodou

```bash
gh run list --workflow publicar.yml --limit 10
```

As execuções do Worker aparecem com o evento `workflow_dispatch`, perto de 10:32 e 12:05 UTC. Na
Cloudflare, os logs ficam em Workers & Pages → `pulso-disparador` → Logs. Uma tentativa que falha
aparece como erro, e a invocação termina em erro se as três falharem.

## Cuidados

- **Nunca** adicione rota, domínio próprio ou `workers_dev` a este Worker. Sem eles, ele não encosta
  na zona `dorly.com.br`.
- `pulso.dorly.com.br` continua *DNS-only* (nuvem cinza) apontando para o GitHub Pages. Não ligue o
  proxy da Cloudflare nesse registro.
- O alarme humano é o check de publicação no Healthchecks (`HEALTHCHECKS_URL`): ele avisa se a
  edição do dia não sair, venha a falha do Worker, do GitHub ou da cozinha. Confira que ele notifica
  por e-mail ou Telegram.
