# Disparador

Um Worker da Cloudflare que, às 07:32, às 09:05 e às 17:15 de Brasília, pede ao GitHub uma
execução de `publicar.yml` com `tarefa=edicao`. É o gatilho principal da publicação diária. O
`schedule` do GitHub atrasa horas ou não dispara, e fica só como reserva, às 07:27 e às 17:10.

O horário da tarde é o herdeiro do `pulso-site-tarde` da AWS (20:15 UTC), que republicava o site se
ele estivesse velho. Aqui, se a edição já saiu de manhã, a corrida da tarde só confere o site no ar
e republica se preciso. Se nenhuma corrida da manhã deu certo, ela gera a edição, atrasada, em vez
de o dia ficar sem jornal até o dia seguinte.

Antes de cada disparo, o Worker confere o estado de `publicar.yml`. Se o GitHub o desligou por 60
dias sem atividade (`disabled_inactivity`), ele religa; se foi desligado à mão
(`disabled_manually`), respeita. Qualquer resposta 2xx do dispatch conta como sucesso (o GitHub
responde 204, ou 200 quando devolve os dados da execução).

O Worker não decide nada. Quem sabe se a edição de hoje já saiu é a cozinha: se saiu, ela responde
`slot-already-published` e para. Por isso disparos a mais não fazem mal.

Ele não tem rota, domínio nem endereço `*.workers.dev`. Só acorda pelo cron.

## Custo

Zero, no plano Workers Free. Três disparos por dia (3 dos 5 crons que a conta gratuita permite) usam uma fração mínima do limite (100 mil
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
   - Expiration: 1 ano. Anote a data e ponha um lembrete para trocar o token antes dela (ver
     "Datas de troca" abaixo).

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

**Depois de mudar `src/index.ts` ou `wrangler.jsonc`** (por exemplo, o horário das 17:15), publique
de novo com o passo 4. Os crons e o código novo só valem depois do deploy.

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

As execuções do Worker aparecem com o evento `workflow_dispatch`, perto de 10:32, 12:05 e 20:15
UTC. Na
Cloudflare, os logs ficam em Workers & Pages → `pulso-disparador` → Logs. Uma tentativa que falha
aparece como erro, e a invocação termina em erro se as três falharem.

## Cuidados

- **Nunca** adicione rota, domínio próprio ou `workers_dev` a este Worker. Sem eles, ele não encosta
  na zona `dorly.com.br`.
- `pulso.dorly.com.br` continua *DNS-only* (nuvem cinza) apontando para o GitHub Pages. Não ligue o
  proxy da Cloudflare nesse registro.
- O alarme humano é o check de publicação no Healthchecks (`HEALTHCHECKS_URL`): ele avisa se a
  edição do dia não sair, venha a falha do Worker, do GitHub ou da cozinha. Confira que ele notifica
  por e-mail ou Telegram (configuração no README da raiz, seção de monitoramento).

## Datas de troca

Tokens vencidos não dão erro no Worker antes do dia: a cozinha ou o dispatch falham, e o
Healthchecks avisa. Melhor trocar antes.

- `GITHUB_TOKEN` deste Worker: 1 ano a partir da criação. Troca: passo 3 acima.
- Chaves do R2 (`R2_*`, ambiente `production` do GitHub): 1 ano, criadas em 2026-10-20; vencem
  por volta de 2027-10-20. Depois de trocar, rode o workflow `Testar chaves`.
- `OPENAI_API_KEY` e `ARTIFICIAL_ANALYSIS_API_KEY`: sem validade conhecida.
