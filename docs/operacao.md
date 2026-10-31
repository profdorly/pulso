# Operação do Pulso

Agendamento, monitoramento e o que fazer para o jornal não parar sozinho. O porquê das regras editoriais está em [como-funciona.md](como-funciona.md); o Worker que dispara as corridas tem o próprio guia em [infra/disparador](../infra/disparador/README.md).

## Agendamento

Uma corrida de `publicar.yml` por dia, num dia normal. Um Worker da Cloudflare, de graça e sem rota, acorda às 07:32, às 09:05 e às 17:15 (Brasília) e, antes de disparar, olha o site no ar: se a capa já mostra a edição de hoje (o `<meta name="pulso:edition">` da home), não dispara nada. A das 07:32 faz o trabalho; as outras só rodam se a edição não saiu. O cron do próprio GitHub, às 17:10, é a rede final para um dia em que o Worker falhar inteiro: ele chega horas atrasado, por volta das 20h, e faz a mesma conferência antes de rodar a cozinha.

Por que assim: nos primeiros dez dias, o cron do GitHub chegou de 2h20 a 6h30 atrasado e nunca salvou uma edição, e quatro das cinco corridas diárias só conferiam o site. Cada corrida passa pelas checagens do GitHub, e foi numa delas que a de 29/10 travou. Menos corridas, menos exposição.

As corridas não andam mais em fila. Duas cozinhas ao mesmo tempo continuam seguras: a cozinha grava no R2 com escrita condicional, e a que chega depois falha sem apagar nada. Uma corrida que falha não muda nada.

O GitHub desliga o agendamento de um repositório depois de 60 dias sem commit. A própria corrida reativa o agendamento, e o Worker religa um workflow que o GitHub já tenha desligado por isso.

### Corrida presa

Às vezes o GitHub perde uma corrida antes do primeiro job: ela fica em "waiting" para sempre e não aceita cancelamento. Em 29/10/2026, às 17:15, uma corrida assim segurou a fila única que existia na época, e 30/10 ficou sem edição. Sem a fila, uma corrida presa perde só o próprio horário: se a edição de hoje não está no ar, o horário seguinte do Worker dispara de novo. No pior caso, a edição sai às 09:05 ou às 17:15.

O painel (`npm run health`) avisa quando vê uma corrida presa nos últimos dois dias. Não é preciso fazer nada. Se a edição do dia ainda não saiu e você não quer esperar o próximo horário: `gh workflow run publicar.yml -f tarefa=edicao`.

O que isto não cobre: o GitHub Actions fora do ar o dia inteiro. Aí só o alerta abaixo e uma corrida à mão, quando ele voltar.

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
