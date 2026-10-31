# Operação do Pulso

Agendamento, monitoramento e o que fazer para o jornal não parar sozinho. O porquê das regras editoriais está em [como-funciona.md](como-funciona.md); o Worker que dispara as corridas tem o próprio guia em [infra/disparador](../infra/disparador/README.md).

## Agendamento

Até cinco corridas de `publicar.yml` por dia. Um Worker da Cloudflare, de graça e sem rota, dispara às 07:32, às 09:05 e às 17:15 (Brasília). O cron do próprio GitHub atrasa horas e às vezes descarta execuções, então fica de reserva às 07:27 e às 17:10.

A primeira corrida que chega faz o trabalho. As outras baixam a cozinha, veem que a edição do dia existe e refazem só o que faltou: a edição, se não saiu; o site, se o site no ar não mostra a edição (o home leva um `<meta name="pulso:edition">`). De resto não gastam nada. As da tarde retomam no mesmo dia uma manhã que falhou. As execuções entram numa fila (`concurrency.queue: max`) e nenhuma cancela outra.

O GitHub desliga o agendamento de um repositório depois de 60 dias sem commit. A própria corrida reativa o agendamento, e o Worker religa um workflow que o GitHub já tenha desligado por isso.

### Corrida presa

Às vezes o GitHub perde uma corrida antes do primeiro job: ela fica em "waiting" para sempre, não aceita cancelamento e, como as corridas andam em fila, segura todas as outras. Foi o que aconteceu em 29/10/2026, às 17:15, e por isso não houve edição em 30/10. O limite de tempo dos jobs não pega esse caso, porque o job nunca começa.

O que existe para isso:

- **O Worker desvia sozinho.** Antes de cada disparo, ele procura corrida em "waiting" há mais de 40 minutos. Tenta cancelar. Se o GitHub recusar, dispara numa fila de desvio (`desvio-<id da corrida presa>`), e a edição sai no horário seguinte do Worker. Também cancela as corridas paradas atrás da presa.
- **O painel mostra.** `npm run health` dá vermelho com "corrida #N está presa no GitHub".
- **À mão, na hora:** `gh variable set PULSO_FILA --body 2` (ou o número seguinte ao atual). Isso troca a fila de tudo, inclusive dos crons de reserva e do push, e a corrida presa fica sozinha na fila antiga. Depois, `gh workflow run publicar.yml -f tarefa=edicao` se a edição do dia ainda não saiu.

## Monitoramento

O [Healthchecks.io](https://healthchecks.io/) recebe sucesso só no fim da corrida, quando o site **no ar** mostra a edição do dia, conferido depois do deploy. Falha em qualquer etapa (cozinha, montagem, verificação, deploy) chega como falha. Sem ping num dia, ele avisa, o que cobre corrida que falhou, deploy que falhou e agendamento que o GitHub descartou.

Configuração do check da edição (`HEALTHCHECKS_URL`):

- modo **Cron**, expressão `30 10 * * *`, fuso UTC, tolerância de 4 h;
- notificação por e-mail **e** por um canal que apita no celular (Telegram, Signal ou o app do Healthchecks). Em 30/10/2026 o alerta chegou só por e-mail e passou despercebido por um dia.

O modo Cron importa. No modo de período, um ping das 17:15 empurraria o próximo alerta para a noite do dia seguinte.

Um segundo monitor, opcional, cobre o catálogo semanal de modelos (`HEALTHCHECKS_MODELOS_URL`): período de 7 dias, tolerância de 2 dias.

No GitHub, em Settings → Notifications → Actions, deixe e-mail só para execuções que falham.

## Tokens

O token do GitHub que o Worker usa e as chaves do R2 do ambiente `production` vencem em um ano. As datas e o passo a passo da troca estão em [infra/disparador](../infra/disparador/README.md#datas-de-troca). Token vencido não dá erro antes do dia: a corrida falha e o Healthchecks avisa. Melhor trocar antes.
