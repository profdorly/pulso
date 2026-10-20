# Pulso da Semana em áudio

**Status:** proposta para piloto, sem implementação em produção  
**Data:** 6 de outubro de 2026  
**Modelo de voz:** ElevenLabs `eleven_v4`, via Text to Dialogue

## Decisão proposta

O Pulso passa a publicar uma edição de texto por dia, às 07:30 BRT. O áudio não acompanha cada edição: uma vez por semana, depois da edição de segunda-feira, o sistema produz o **Pulso da Semana**, uma conversa de 10 a 12 minutos entre duas vozes, com teto de 15 minutos.

O episódio não é uma leitura nem uma concatenação das edições. É uma seleção de 8 a 10 histórias da semana, organizada em 4 a 6 blocos. Duas matérias só podem ser tratadas como a mesma história quando o agrupamento tiver evidência conservadora; compartilhar apenas um assunto não basta.

O piloto vem antes da infraestrutura. Primeiro produzimos um roteiro e um episódio completo a partir de uma semana já publicada. Só depois de ouvir, medir e auditar o resultado decidimos se o job entra no fluxo automático.

## Por que semanal

- Consome aproximadamente 40 a 60 mil créditos por mês, incluindo uma margem de 15% para tentativas recusadas.
- Dá espaço para explicar relações entre anúncios sem transformar o Pulso em rádio em tempo real.
- Uma geração por semana permite revisão humana no começo.
- Reduz a pressão de manter duas vozes impecáveis todos os dias.
- Cria um produto diferente da edição: a edição registra; o episódio organiza a semana.

O custo dessa escolha é uma etapa editorial nova. O sistema precisa selecionar, agrupar e ordenar uma semana inteira. Não basta entregar sete JSONs ao modelo e pedir um podcast.

## Contrato editorial

### Janela

O episódio fecha depois da edição de segunda-feira. A janela inclui as edições publicadas desde a edição de segunda anterior, exclusivamente, até a edição atual, inclusive. O intervalo é definido por `capturedAt`, sempre em `America/Sao_Paulo`, e não pelo nome dos diretórios.

Isso produz sete janelas editoriais completas quando o Pulso estiver na cadência de uma edição por dia. Edições silenciosas entram no registro da semana, mas não fornecem histórias.

O identificador público pode usar a semana ISO, por exemplo `2026-W41`, mas o manifesto precisa guardar também o primeiro e o último `capturedAt`. Semana ISO sozinha não prova quais revisões alimentaram o episódio.

### Seleção

A seleção semanal começa de forma determinística:

1. Carregar somente edições canônicas e públicas da janela.
2. Recusar artefato inválido e registrar lacunas; nunca completar uma semana com texto de fonte externa.
3. Eliminar duplicatas exatas por URL canônica e relações de `original` já registradas.
4. Formar grupos conservadores apenas quando os itens compartilham pelo menos duas entidades inequívocas, seguindo o princípio já usado no fio do arquivo.
5. Atribuir prioridade a itens que apareceram no digest, anúncios de fonte primária, itens corroborados e histórias presentes em mais de uma edição.
6. Preservar variedade de tópico, região e origem; um único laboratório ou veículo não domina o episódio.
7. Entregar ao roteirista de 8 a 10 histórias, com no máximo duas peças do mesmo grupo.

O agrupamento não autoriza palavras como “desdobramento”, “reação” ou “consequência”. O sistema sabe que os textos compartilham entidades; não sabe que um causou o outro.

### Estrutura do episódio

Duração-alvo: 10 a 12 minutos. Teto: 15 minutos. O roteiro deve ficar inicialmente entre 8 mil e 10 mil caracteres falados; a taxa real será calibrada com as vozes escolhidas.

Estrutura:

1. Abertura fixa e aviso de vozes sintéticas — 15 a 20 segundos.
2. Panorama — três manchetes em até 45 segundos.
3. Quatro a seis blocos — pergunta curta do apresentador, explicação do analista e transição.
4. Fecho — onde ler as fontes e data da próxima edição.

Papéis:

- **Apresentador:** abre, pergunta, resume transições e controla o ritmo.
- **Analista:** explica o que cada fonte publicou. Não prevê, recomenda nem acrescenta contexto externo.

A conversa deve soar natural sem simular espontaneidade inexistente. Não usar risadas, interrupções, surpresa ou opinião como decoração. Tags de entrega do v4 ficam restritas a instruções leves como `[calm]`, `[curious]` e `[measured]` até o piloto provar que melhoram o resultado.

## Roteiro auditável

O roteirista recebe somente o texto que já sobreviveu aos gates da edição: título, `titlePt`, `blurbPt`, `summaryPt`, digest e metadados publicados. Não recebe busca aberta nem instrução para preencher contexto.

Saída proposta:

```json
{
  "schemaVersion": 1,
  "weekId": "2026-W41",
  "title": "Pulso da Semana — 6 de outubro",
  "targetDurationSeconds": 660,
  "segments": [
    {
      "id": "seg-1",
      "title": "Modelos",
      "turns": [
        {
          "speaker": "host",
          "text": "A semana começou com dois anúncios de modelos.",
          "sourceItemIds": ["item-1", "item-2"],
          "delivery": "measured"
        }
      ]
    }
  ]
}
```

Regras:

- Toda fala factual tem pelo menos um `sourceItemId`.
- Os IDs precisam existir no conjunto semanal.
- Números, preços, percentuais, datas e versões precisam aparecer nos itens citados.
- Transições sem fatos podem ter `sourceItemIds: []`, mas não podem conter nomes, números ou afirmações sobre o mercado.
- A soma do texto falado respeita o teto de caracteres antes de qualquer chamada de voz.
- A abertura informa que as vozes são sintéticas.
- O transcript publicado remove as tags de entrega, mas preserva exatamente as palavras faladas.

Ordem dos controles:

1. Validar schema, IDs, limite de caracteres e equilíbrio entre as vozes.
2. Aplicar o gate determinístico contra os itens citados.
3. Aplicar a passada de voz editorial/conversa.
4. Auditar semanticamente o roteiro final contra os itens publicados.
5. Repetir o gate determinístico, porque a revisão produziu texto novo.
6. Congelar `scriptHash`; nenhum texto muda depois desse ponto.
7. Enviar o roteiro congelado ao ElevenLabs.

Se uma fala reprovar, o sistema tenta uma revisão do bloco uma única vez. Não existe laço de reescrita. Se o roteiro final não passar, aquela semana fica sem episódio.

## Mudança no fluxo

### Hoje

```text
Scheduler 07:30/16:30
  → Lambda publisher
  → runEdition
  → gates e auditoria
  → commit SQLite + promoção dos JSONs
  → site publisher
  → S3/CloudFront
```

### Proposto

```text
Scheduler diário 07:30
  → Lambda publisher
  → runEdition
  → gates e auditoria
  → commit SQLite + promoção dos JSONs
  → site publisher de texto
  → se segunda-feira: mensagem SQS WeeklyAudioRequested

SQS
  → Lambda weekly-audio
  → carrega a janela e fixa sourceRevisionHash
  → seleciona e agrupa histórias
  → escreve, humaniza e audita o roteiro
  → gera blocos no ElevenLabs v4
  → concatena, normaliza e mede o MP3
  → grava MP3 + transcript
  → grava manifesto ready por último
  → solicita nova build do site
```

A Lambda editorial não espera o áudio. Erro, timeout ou falta de crédito no ElevenLabs nunca impede a edição textual.

Além do disparo pós-commit da segunda-feira, um schedule de recuperação pode rodar às 10:00 BRT. Ele só envia a mensagem quando existe uma edição de segunda e não existe manifesto correspondente ao mesmo `sourceRevisionHash`.

## Unidade de áudio

Criar uma Lambda separada, acionada por SQS, com:

- secret próprio contendo apenas `ELEVENLABS_API_KEY`;
- dois `voice_id` fixos em configuração;
- quota da chave limitada no ElevenLabs, se o plano permitir;
- leitura dos JSONs da janela e escrita apenas no prefixo semanal;
- DLQ e poucas tentativas;
- timeout de 10 a 15 minutos, medido no piloto;
- FFmpeg/FFprobe na imagem para concatenação, normalização e duração;
- orçamento semanal por caracteres antes da primeira chamada;
- lock condicional por `weekId + sourceRevisionHash + scriptHash`.

A API é não determinística. Repetir um job pode cobrar novamente. O job verifica o manifesto e o lock antes de gerar, grava o estado operacional e mantém os request IDs. Ainda existe uma janela residual se o provedor concluir e a Lambda morrer antes de persistir o resultado; o piloto deve verificar se o endpoint vigente oferece idempotência de requisição.

## Geração no ElevenLabs

Usar `model_id: eleven_v4`, não `eleven_v4_turbo`. O trabalho é batch e prioriza qualidade.

A documentação recomenda até 2.000 caracteres por requisição. Um episódio de 8 a 10 mil caracteres exige de quatro a seis chamadas. Os cortes acontecem entre segmentos, nunca no meio de uma fala.

Cada chamada usa:

- `language_code: "pt"`;
- as mesmas configurações de stability e similarity;
- seed estável como ajuda, sem tratá-lo como garantia;
- `previous_request_ids` e `previous_text` para continuidade;
- dicionário de pronúncia para empresas, pessoas, siglas e modelos;
- MP3 com qualidade definida no piloto.

A montagem final normaliza volume entre blocos e mede a duração. Não acelerar nem cortar o áudio para caber. Se exceder 15 minutos, o artefato é recusado e o roteiro precisa ser menor na próxima tentativa editorial.

## Artefatos

```text
weekly/2026-W41/episode-r1-<scriptHash>.mp3
weekly/2026-W41/transcript-r1-<scriptHash>.json
weekly/2026-W41/episode.json
weekly/index.json
```

`episode.json` é o commit marker e só é gravado depois dos binários. Campos mínimos:

- `weekId`, `revision`, `sourceEditionIds` e `sourceRevisionHash`;
- título, descrição e intervalo editorial;
- `scriptHash`, modelo, vozes e request IDs;
- caracteres enviados, tentativas e créditos estimados;
- duração, bytes, MIME, SHA-256 e paths;
- status `ready` e timestamp;
- versão do schema e do prompt.

Falha operacional não vira manifesto `ready`. O status do job fica em logs/métricas e, se necessário, em um objeto separado que o site não interpreta como episódio.

## Site e distribuição

Primeira fase:

- bloco “Pulso da Semana” na home e no arquivo;
- `<audio controls preload="metadata">`, sem autoplay;
- duração, data, aviso de vozes sintéticas e link para transcript;
- transcript no HTML para acessibilidade e indexação;
- MP3 imutável com cache longo;
- ausência do episódio não gera espaço vazio nem erro na edição.

Segunda fase, só depois de duas ou três semanas consistentes:

- `/podcast.xml` dedicado, com enclosure, GUID estável, artwork e metadados próprios;
- submissão a aplicativos de podcast;
- nunca misturar o enclosure ao feed jornalístico ou aos feeds de tópico.

A decisão de “site já atualizado” precisa incluir o hash de `episode.json`; caso contrário, o site pode publicar o texto, considerar-se atual e nunca copiar o áudio que terminou depois.

## Uma edição de texto por dia

Implementada no repositório (ainda sem deploy). Como ficou:

- schedule das 07:30 mantido; o das 16:30 removido da cozinha;
- a edição única cobre o que as duas cobriam: teto de 50 itens, 50 entradas por feed, piso de imprensa 16 e limite de 6 por veículo, auditoria e humanizador em paralelo, timeout da Lambda em 900 s e teto de gasto em US$ 4 por corrida;
- `tarde` e `meio-dia` seguem slots históricos válidos, e `inferSlot` aponta sempre para `manha`;
- a edição silenciosa passou a exigir capa com mais de 36 h, em vez de uma regra de data: tira o cara ou coroa das 24 h com menos código;
- o catch-up das 17:15 ficou: sem ele, o alarme de frescor perderia a segunda amostra do dia e precisaria de período maior que 24 h. Com ele, período e limiar seguem válidos e o alarme dispara às 17:15 do primeiro dia sem edição;
- README, testes de schedule e notas de deploy atualizados.

## Consumo esperado

Para 10 a 12 minutos:

- 8 a 12 mil créditos por episódio antes de regenerações;
- aproximadamente 35 a 52 mil créditos por mês;
- aproximadamente 40 a 60 mil por mês com 15% de margem;
- 7 a 11 MB por episódio em MP3 96 kbps;
- armazenamento mensal inferior a 50 MB.

O ledger precisa registrar caracteres efetivamente enviados e tentativas. Estimativa pelo roteiro não substitui a cobrança observada na conta.

## Piloto imediato

Não há CLI ElevenLabs instalada nem chave disponível no ambiente atual. O piloto real começa assim que houver uma chave com quota e dois pares de vozes candidatas.

### Etapa 1 — pacote editorial, sem gastar créditos

1. Escolher uma janela já publicada com pelo menos cinco edições regulares.
2. Gerar o conjunto semanal e o relatório de seleção.
3. Produzir um roteiro de 8 a 10 minutos no schema proposto.
4. Rodar gates e auditoria.
5. Revisar manualmente seleção, fidelidade, ritmo e pronúncias esperadas.

Saídas locais:

```text
.tmp/weekly-audio-pilot/weekly-input.json
.tmp/weekly-audio-pilot/selection.json
.tmp/weekly-audio-pilot/script.json
.tmp/weekly-audio-pilot/script.txt
.tmp/weekly-audio-pilot/audit.json
```

Nada disso entra no artefato público.

### Etapa 2 — escolha das vozes

Gerar os mesmos 60 a 90 segundos com dois pares de vozes. Manter texto, modelo, seed e configurações iguais. Comparar:

- português brasileiro e consistência de sotaque;
- nomes próprios, empresas, versões e siglas;
- diferença suficiente entre as duas vozes;
- naturalidade das perguntas e transições;
- ruído, plosivas, sibilância e variação de volume;
- comportamento na costura de dois requests.

Orçamento: aproximadamente 3 mil créditos para dois pares, mais uma pequena margem.

### Etapa 3 — episódio completo

Com o par vencedor, gerar o episódio completo em quatro a seis blocos, montar o MP3 e publicar somente em `.tmp`. Medir:

- caracteres cobrados e número de tentativas;
- tempo de geração por bloco e total;
- duração real e razão caracteres/segundo por voz;
- diferença de loudness entre blocos;
- costuras audíveis;
- falhas e comportamento de retry;
- tamanho final do arquivo.

Orçamento esperado do piloto completo: 8 a 12 mil créditos; teto de 15 mil. Somando a seleção de vozes, reservar 12 a 18 mil créditos.

### Etapa 4 — escuta cega

Ouvir o episódio sem acompanhar o texto e anotar:

- afirmações difíceis de entender;
- pontos que parecem leitura alternada;
- trechos artificiais ou performáticos;
- nomes pronunciados incorretamente;
- histórias longas demais ou sem contexto;
- vontade de continuar ouvindo após dois minutos.

Depois comparar o transcript com cada item citado. O episódio só passa se não houver afirmação factual sem apoio.

## Critérios de aprovação

- 8 a 12 minutos, nunca acima de 15.
- Entre 8 e 10 histórias, sem uma fonte dominar.
- Toda fala factual rastreável aos itens citados.
- Zero número, versão, data, atribuição ou causalidade sem apoio.
- Nenhuma costura claramente audível.
- Loudness e identidade das vozes consistentes.
- Menos de 15% dos créditos gastos em regenerações.
- Máximo de 12 mil créditos no episódio aprovado de 12 minutos.
- Roteiro compreensível sem abrir a página.
- Falha do áudio não altera nem atrasa a edição textual.

## Decisão depois do piloto

**Prosseguir** se o episódio aprovado respeitar fidelidade, duração, pronúncia e teto de créditos com no máximo uma revisão de roteiro e uma geração por bloco.

**Ajustar** se o conteúdo estiver correto, mas a conversa soar como leitura. Nesse caso, mudar o contrato do roteiro antes de trocar tecnologia.

**Parar** se nomes e siglas continuarem ruins com dicionário, se as costuras forem evidentes, se a auditoria não conseguir conter contexto inventado ou se o custo por episódio aprovado exceder 15 mil créditos.

## Referências do provedor

- [Eleven v4](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4)
- [Text to Dialogue](https://elevenlabs.io/docs/overview/capabilities/text-to-dialogue)
- [Stream Text to Dialogue](https://elevenlabs.io/docs/api-reference/text-to-dialogue/stream)
- [Changelog de 28 de setembro de 2026](https://elevenlabs.io/docs/changelog/2026/9/28)
- [Créditos e produtos](https://elevenlabs.io/docs/overview/intro)

As informações das referências foram resumidas e parafraseadas.