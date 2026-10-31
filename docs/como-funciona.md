# Como o Pulso funciona

O detalhe de engenharia por trás de cada edição: o que entra, como o texto é escrito e conferido, e por que cada regra existe. A versão para o leitor está em [/metodologia](https://pulso.dorly.com.br/metodologia/); as medições que embasam as decisões estão em [`research/`](../research/).

## A corrida do dia

Uma edição por dia, às 07:30 em Brasília: 18:30 na China e 12:30 em Berlim, com o dia americano anterior já publicado, o asiático fechado e o europeu em andamento. A janela vai da capa anterior até a corrida (~24 h), com teto de 50 itens; cada feed é lido até 50 entradas. Às segundas, a mesma corrida captura antes o catálogo de modelos, para que a capa de segunda já traga os números da semana; se a captura falha, a de terça tenta de novo.

Tudo roda no GitHub Actions (`.github/workflows/publicar.yml`). A cozinha — o banco SQLite com os itens já vistos, os snapshots de benchmark e as próprias edições — é **um arquivo só** num bucket R2 (`backend/src/kitchen/`): a corrida baixa, roda e devolve com escrita condicional (`If-Match` na versão baixada). Uma corrida que perde a disputa falha em vez de sobrescrever a outra; uma corrida que falha não devolve nada, e a cozinha fica como estava. Uma cozinha que sumiu é erro: só a primeira corrida de um fork, com `--init`, começa do zero, para que um bucket errado não recomece o jornal no #1. Cada envio deixa uma cópia em `backups/`, guardada 30 dias. Uma trava do próprio bucket (R2 bucket lock) impede apagar ou sobrescrever qualquer cópia nos primeiros 25 dias, inclusive com a chave da cozinha: quem roubar essa chave consegue estragar a cozinha atual, não o histórico. Itens que nenhum feed mostra há 90 dias são esquecidos; "mostra" vale também para os já publicados ou recusados, que cada leitura do feed marca como vistos.

O upload é o ponto sem volta. A cópia datada e a limpeza das antigas vêm depois e, se falham, viram aviso na corrida em vez de derrubá-la — derrubar ali deixaria uma edição gravada sem chegar ao site.

O `schedule` do GitHub atrasa horas e às vezes descarta execuções, então quem dispara é um Worker da Cloudflare (`infra/disparador`), às 07:32, às 09:05 e às 17:15. Antes de disparar, ele olha se a capa no ar já mostra a edição de hoje (o home leva um `<meta name="pulso:edition">`); se mostra, não dispara. Num dia normal há uma corrida só, e os horários seguintes retomam no mesmo dia uma manhã que falhou. O cron do GitHub das 17:10 é a rede final, com a mesma conferência. As corridas não dividem fila: duas cozinhas ao mesmo tempo são barradas pela escrita condicional no R2. Detalhes em [operacao.md](operacao.md#agendamento).

O monitor externo recebe sucesso só no fim, quando o site no ar mostra a edição; falha em qualquer etapa — cozinha, montagem, verificação, deploy — chega como falha.
### Como os itens são escolhidos

A seleção **não** é por recência. Era, e produzia capas inteiramente brasileiras — não por defeito de prompt, mas por aritmética: veículo brasileiro de tech geral publica muitos itens por dia contra alguns por semana dos labs, e na hora da corrida em São Paulo o item local pode ter minutos de vida enquanto o do SCMP já tem horas, porque saiu no horário asiático. Ordenar por recência é ordenar por frequência de publicação **e** por proximidade de fuso, e os dois vieses apontam para o mesmo lugar. Nenhum prompt corrige isso: os itens internacionais eram cortados antes de qualquer modelo os ver.

`backend/src/edition/select.ts` aplica a regra editorial:

- **Anúncio de lab e descoberta ficam fora da cota.** São fonte primária: o anúncio *é* o fato. Racionar anúncio primário pelo continente de origem seria censurar fato por origem.
- **Imprensa é distribuída por cota geográfica** entre Brasil, EUA, Europa e Ásia. A cada vaga, entra a região que pegou menos até ali; empate é decidido pelo melhor candidato. Ordem fixa daria a sobra de toda rodada parcial sempre à mesma região.
- **Um mesmo veículo de imprensa entra no máximo três vezes.** A cota por continente não basta se uma redação preenche o continente sozinha.
- **Piso de 8 vagas para imprensa**, para que um dia de muitos anúncios não deixe a cota sem nada para equilibrar — limitado a metade da edição, porque o piso existe para proteger equilíbrio, não para passar na frente de um anúncio.
- **O leitor vê Imprensa e Direto dos labs.** Região é cota na escolha e dateline ao lado do veículo (`Olhar Digital · Brasil`). Veículo daqui cobrindo Musk entra na imprensa.
- **Reportagem acima de opinião** dentro da região; recência só como desempate.
- Região sem candidato **não** segura vaga.

Opinião é **marcada, não excluída** (`genre: "opinion"`, etiqueta visível no leitor). Análise boa tem valor; o dano é ela passar por fato novo. A detecção é conservadora de propósito — prefixo de manchete e segmento de caminho, nada de inferir por tom — porque falso positivo rebaixa e rotula errado uma reportagem de verdade.

Corroboração entre veículos, que é o sinal mais forte de noticiabilidade, não entra na seleção: saber que dois itens são a mesma história exige ler as duas páginas, e páginas só são baixadas para quem já passou no corte. Ela é calculada depois e mostrada ao leitor.

### Fonte original

Esperar veículo brasileiro traduzir custa dias, e às vezes ninguém traduz. A maior parte disso se resolve carregando os feeds internacionais direto. Sobra o caso em que a mesma história chega duas vezes, uma da fonte e outra de quem reescreveu, e aí o leitor tem que receber a fonte.

A evidência é o HTML que a verificação de link **já baixa**. Antes, `extractEvidenceText` fazia `stripHtml` e jogava fora exatamente os dois sinais precisos de replicação; agora eles são preservados sem nenhuma requisição a mais:

- `<link rel="canonical">` apontando para outro host. Cópia sindicalizada declara a origem assim; é quase conclusivo.
- Link de saída da página de um item para a URL de outro item da mesma edição. Quem reescreve normalmente linka o que reescreveu.

**A regra que preserva a promessa de exatidão: resumir só do texto que foi efetivamente baixado, e linkar o que foi resumido.** Então a replicação só é descartada em favor do original quando o original está na própria edição e foi lido. Quando a origem é real mas inalcançável — a Reuters responde **401** a cliente que não é navegador, e a AP não tem feed — a replicação fica, carrega o link que o leitor consegue abrir, e a origem é **nomeada** ao lado (`original: reuters.com`). Linkar uma página que não conseguimos ler seria publicar um resumo impossível de conferir contra o que ele aponta.

Casamento aproximado de título foi considerado e **rejeitado**: entre idiomas os únicos tokens que sobrevivem são nomes próprios, então a comparação seria fraca justamente onde é necessária — e um falso positivo não erra a ordem, ele **apaga uma notícia real** da edição. Agrupamento perdido custa uma duplicata; agrupamento errado custa notícia.

Limitação registrada: o agrupamento roda depois da seleção, porque depende das páginas baixadas. Então ele desduplica dentro do conjunto já escolhido, não influencia quem entra. Baixar a página de todo candidato da janela multiplicaria requisições contra todos os veículos em toda corrida.

### O texto dos itens

Até aqui, todo texto sobre um item era escrito a partir do **título** — o worker nunca via a matéria. Isso não é qualidade a ajustar, é limitação estrutural: paráfrase de manchete não consegue dizer o que a reportagem apurou.

Enquanto isso, a verificação de link baixa o corpo de toda matéria e entrega ao gate de evidência, que usa esse texto **só para recusar**. Agora o mesmo corpo alimenta a escrita. Nenhuma requisição a mais; só tokens de entrada.

São dois textos com propósitos diferentes:

- **`blurbPt`** — uma frase, feita do título. A capa é superfície de varredura, então ela fica com a frase curta.
- **`summaryPt`** — um ou dois parágrafos em PT-BR feitos do corpo da matéria, exibidos na **página da edição**, onde o leitor escolheu ler.

O título fica no idioma original de propósito: o resumo é a ponte para o português, e o título continua sendo o que o veículo publicou.

Regras do resumo: usar exclusivamente o texto fornecido; não acrescentar contexto, número, data, valor ou nome que não esteja ali; e **devolver vazio é resultado aceitável** — melhor que preencher com suposição. Um item sem resumo publica com título e link. Cada matéria é uma chamada isolada, com concorrência limitada, para que uma resposta ruim não custe o lote.

E os parágrafos passam pelo mesmo gate determinístico que o resto — precisando mais dele, porque texto mais longo tem mais espaço para um número escorregar da página de onde foi escrito. Nem `blurbPt` nem `summaryPt` valem como evidência de si mesmos.

### Auditoria de fidelidade

O gate determinístico casa dinheiro, porcentagem, número preciso e versão de modelo contra o texto da página. É barato, não pode ser convencido do contrário, e é cego para o resto. Ele não sabe dizer que "lançou" foi escrito onde a matéria dizia "planeja lançar", nem que uma fala foi atribuída à empresa errada. Isso é semântico — e ficou muito mais provável quando o texto do item cresceu de uma frase para dois parágrafos.

Então existe um auditor de modelo, e ele roda **atrás** do gate: a checagem barata e inegociável primeiro, o modelo só sobre o que sobrou.

Cinco regras, cada uma recusando a alternativa mais óbvia:

- **Por item, não por edição.** Um veredito para a capa toda deixaria uma frase à deriva apagar todos os parágrafos. Veredito por item custa os mesmos tokens e perde só o que está errado.
- **Uma revisão, nunca um laço.** "Revisar até o auditor aprovar" não tem garantia de terminação e multiplica gasto contra o teto da corrida — e encostar no teto pula as etapas seguintes, que é o pior desfecho disponível.
- **A revisão volta pelo gate determinístico antes de ser aceita.** A reescrita é texto novo que nunca passou pelo gate; mandá-la direto ao auditor deixaria um preço inventado entrar pela correção de outro problema. A checagem é função pura sobre evidência que já está em memória, então custa zero.
- **Veredito ilegível derruba o texto gerado.** Publicar prosa não auditada seria embarcar o risco sem o controle que existe para conter. Sem veredito, o que sai é **todo** o texto em português do item — `titlePt`, `blurbPt` e `summaryPt` — e o item continua publicando com o **título original da fonte** e o link, que são o que a verificação de link já provou existir. Com veredito de reprovação, sai só o campo onde está cada trecho apontado: o auditor recebe os três como um bloco, cita as palavras exatas que não se sustentam, e o resto do bloco é texto que ele leu e deixou passar. Se algum trecho não puder ser localizado num campo, sai tudo, como antes. No OpenAI o veredito vem por Structured Outputs, com o esquema imposto pela API, e a leitura aceita prosa em volta e autocorreção (vale o último veredito), então ilegível virou falha de rede, não de formato.
- **A evidência é o que o redator tinha.** O título e o blurb são escritos a partir do resumo que o veículo publica no feed; o parágrafo, a partir da página. O auditor recebe os dois. Quando a página não abre (site que bloqueia robô), o item não perde mais todo o texto sem auditoria: título e blurb são julgados contra o título e o resumo do feed, e só o parágrafo sai, porque sem página ele não teria como ter sido escrito nem conferido.

A mesma regra vale para o teto de gasto: se a auditoria for pulada por custo, os parágrafos **saem**. O teto não pode virar atalho para publicar sem auditoria.

O auditor não deve julgar o próprio texto, porque juiz favorece o que ele mesmo escreveu. Até outubro de 2026 isso significava outra família: quem escrevia era OpenAI e quem auditava era **Bedrock Claude Opus 4.6**. Sem acesso ao Bedrock, o auditor passou a ser o **GPT-6.1 Sol** com raciocínio baixo: mesma empresa, mas outro modelo que não o **GPT-6 Luna**, que escreve título, blurb e resumo. A edição avisa quando o auditor é o mesmo modelo que escreveu ou revisou o texto julgado. Na troca, o Sol empatou com o Opus no corpus semeado (21 de 21) e, numa edição real de 50 itens, leu todos os vereditos, manteve 5 textos que o Opus tinha removido sem motivo e pegou um anúncio publicado como fato consumado que o Opus deixou passar, por cerca de um terço do custo. O contrato continua mínimo — texto de sistema, texto do usuário, texto de volta —, então trocar de provedor é trocar um adaptador. O preço de cada modelo candidato está em `MODEL_PRICES` independentemente de como a conta paga por ele: o ledger reporta o que a corrida custa, não o que foi faturado.

A avaliação medida está em `research/auditor-eval.md` — 21 casos sintéticos com defeitos semeados, metade sem defeito de propósito. Rodar com `npm run spike:auditor`.

Item que falha por motivo transitório (timeout, bloqueio de bot, 5xx) volta como `retryable` na corrida seguinte; 404, homepage, título divergente, alvo interno e replicação são terminais. Item acima do teto de 50 por edição fica `retryable` com motivo `cap`, sem gastar tentativa. Republicar um slot exige `--force`, que versiona o artefato anterior como `<slot>.superseded-<capturedAt>.json` e devolve um superconjunto.

```bash
npm run edition -- --slot=manha --force
```

### Busca na web além dos feeds (em sombra)

Os feeds são fixos, então o que as redações deles não cobrem nunca chega à edição. Por isso a corrida também busca na web as notícias de IA da própria janela que **não** estão na lista que os feeds trouxeram (`backend/src/fetchers/webSearch.ts`): doze chamadas em paralelo, uma para cada combinação de região (EUA e Europa, Ásia, Brasil e América Latina) e tema (lançamentos, negócios e infraestrutura, política e regulação, uso em setores), com **GPT-6.1 Terra** em raciocínio médio, no máximo 3 buscas cada. Cada região informa a própria localização à ferramenta de busca, que sem isso supõe um leitor nos EUA. Ficam bloqueados os domínios dos feeds, agregadores, redes sociais e redações que recusam leitor automático. URL que a busca não devolveu de fato é descartada no código.

No teste de 31 de outubro de 2026 (três janelas de 24 horas, mesmos feeds e checagens), essa forma de buscar trouxe 37 matérias que passaram em tudo com o Terra, contra 8 da versão anterior (três chamadas amplas com GPT-6 Luna). Com a mesma busca, a Luna trouxe 18 e o GPT-6.1 Sol, 23. O custo fica em cerca de US$ 0,90 por corrida. Por matéria aproveitada, o Terra sai praticamente pelo mesmo preço que a Luna na busca nova.

Com `PULSO_WEB_SEARCH=shadow`, cada resultado passa pelas checagens que enfrentaria como candidato — já conhecido, link abrindo com o título certo, **data de publicação lida na própria página** dentro da janela, filtro de tema — e vira uma linha `pulso-web-search-shadow` no log da corrida, sem publicar nada (`backend/src/edition/webSearchShadow.ts`). O custo entra na edição como `search` e `search-filter`.

Na semana de 13 a 19 de outubro de 2026 a busca trouxe 42 candidatos e 18 passaram em tudo. Dos 24 descartados, 11 eram de redações que bloqueiam leitor automático (AP, UOL, El País…), que agora ficam fora da busca, e 6 eram matérias em chinês, japonês e árabe recusadas por um defeito: a comparação de título só enxergava letras latinas, e um título nessas escritas não casava nem com a própria página. A comparação agora lê qualquer escrita (pares de caracteres onde não há espaço entre palavras).

## O texto, do feed à capa

Texto em PT-BR (headline, lede, bullets, blurbs) passa pelo Humanizador **antes** de gravar a edição: skill no Cursor (`.cursor/skills/humanizador`) e uma passada no publisher (`backend/src/edition/humanize.ts`). A skill sozinha não basta: a corrida agendada não tem um editor humano no meio.

Quem escreve já recebe as mesmas regras (`WRITER_STYLE_RULES`), e a passada no publisher só gasta modelo onde há o que corrigir: a capa é sempre revisada; blurb ou resumo de item vai para o modelo só quando o detector determinístico (`backend/src/edition/tells.ts`) acha marca de IA nele, e vai com o trecho apontado. Texto sem marca segue como foi aprovado. Os itens viajam com ids curtos em vez da URL, que o modelo copiava de volta duas vezes por item.

Antes de publicar, o publisher abre cada URL: 404/homepage/matéria errada saem da edição. Item de RSS que o site bloqueia para bot (403) no host do veículo pode ficar; discovery inventado não. Toda URL passa por uma guarda antes da requisição: protocolo, host e os endereços que o host resolve, revalidados em cada redirect — um feed não leva o publisher a um endereço interno.

Conteúdo de RSS, de página e de busca é entrada não confiável. Os prompts marcam o bloco de itens como dados de terceiros, e a garantia real fica no código: bullet cuja URL não está na edição é descartado, mesmo que o modelo obedeça a uma instrução injetada. Manchete que já saiu em outra edição é recusada — o modelo vê as anteriores, mas a conferência é no código, depois de humanizar e do gate de evidência.

Depois do texto pronto, um **gate de evidência** checa as alegações que causam dano quando erradas — dinheiro, porcentagem, número preciso e versão de modelo — contra a fonte. A evidência é o texto da página que a verificação de link já baixou, mais os metadados do item e o snapshot de benchmarks da própria edição: nenhum fetch extra e nenhuma chamada de modelo a mais, então o gate não move o custo por edição. Bullet ou blurb com alegação sem suporte sai; headline ou lede sem suporte revertem ao stub, que é montado só com títulos da fonte. O `blurbPt` gerado pelo modelo não vale como evidência de si mesmo.

Prosa, enquadramento e juízo editorial **não** são checados. Verificar tudo custaria uma segunda passada de modelo por item e rejeitaria muito mais do que pegaria.

Quando nada sobrevive à verificação, o comportamento depende da idade da última capa. Capa recente: não escreve nada, o leitor continua vendo notícia atual. Capa com mais de 36 h ou inexistente: publica uma **edição silenciosa** (`kind: "quiet"`) que diz o que foi checado e por que nada entrou, em vez de deixar a home vazia ou passar notícia velha por atual. Uma edição silenciosa não fecha a janela — itens pendentes seguem elegíveis. O limite é 36 h, e não 24, porque com uma corrida por dia a capa anterior tem ~24 h em toda corrida: a fronteira de 24 h virava cara ou coroa decidida por segundos de atraso na invocação. Com 36 h, uma manhã sem notícia mantém a capa de ontem e a segunda publica a edição silenciosa.

Cada corrida tem teto de gasto (`PULSO_MAX_EDITION_USD`, padrão US$ 4). Ao atingir o teto, as etapas de modelo restantes são puladas, a edição cai no caminho gratuito e o motivo fica registrado em `sourceFailures`. O padrão subiu de US$ 1 quando os parágrafos passaram a ser escritos do corpo da matéria: essa etapa manda até 12 mil caracteres de página por item, então uma edição cheia encostava no teto antigo — e encostar no teto não é evento leve, é cair no stub. Subiu de novo, para US$ 4, quando as duas edições diárias viraram uma com até o dobro de itens: o teto diário continua o mesmo.

Cada edição ganha uma capa 16:9, desenhada como SVG pela cozinha (`backend/src/edition/cover/`).

## Catálogo de modelos

O catálogo é artefato próprio (`models.json`), não parte de cada edição.

```bash
npm run edition -- --benchmarks   # grava data/editions/models.json
```

```

A decisão de o que publicar veio de medir a fonte, não de ler a documentação dela. O spike está em `research/aa-coverage.md` e pode ser refeito com `node scripts/spike-aa-coverage.mjs`. O que ele mostrou no tier gratuito da Artificial Analysis:

| modalidade | cobertura |
| --- | --- |
| `language` (200 modelos) | inteligência 99%, preço 68%, velocidade 53%, código 35%, agêntico 25% |
| 6 arenas de imagem/vídeo | **só** `id`, `slug`, `name`, criador, `elo` e `ci_95` |

Daí duas consequências. Texto ganha índice, preço e velocidade — cada número com fonte, benchmark, versão da suíte e data. Imagem e vídeo ganham **apenas preferência humana** com o intervalo de confiança visível, porque não existe preço, velocidade nem amostra para essas modalidades: um guia de decisão ali seria invenção. Elo de uma arena não se compara com o de outra nem com os índices de texto, e a página diz isso.

Dado ausente é `—`, nunca zero. Preço faltante tratado como zero colocaria modelo sem preço no topo de "mais barato" — o erro mais caro que essa página poderia cometer. `rankBy` separa quem não tem o dado, e a tabela informa quantos modelos cada coluna cobre.

Há **teto de publicação**: 30 modelos de texto (por índice de inteligência) e 20 por arena (por Elo). Os 620 modelos completos serializam em 622 kB; o teto é fixado no que a página realmente renderiza, então nada é guardado sem ser exibido. O artefato registra `totalAvailable` — quanto a fonte mediu — e a página declara os dois números e o eixo do corte, para que "o mais barato" não seja lido como afirmação sobre o mercado inteiro. Resultado: 152 kB no arquivo, 5,8 kB gzip na rede.


A página de modelos responde primeiro às perguntas que o leitor traz — o mais inteligente, o mais rápido, o mais barato e o melhor custo-benefício (`frontend/src/lib/modelPicks.ts`) — com a regra de cada lista escrita ao lado. A Artificial Analysis lista cada configuração de raciocínio como um modelo ("Claude Opus 5.5 (Max)", "(High)"…), então as listas e os gráficos mostram cada modelo uma vez, na sua melhor configuração; a tabela mostra todas. "Custo-benefício" é a fronteira de preço × inteligência: cada modelo nela é o mais inteligente da lista pelo seu preço ou menos, e nenhum outro é ao mesmo tempo mais inteligente e mais barato. O preço é o combinado de 3 tokens de entrada para 1 de saída, o mesmo que a fonte usa.

A cada captura, a cozinha compara com a anterior (`backend/src/models/changes.ts`) e a página diz o que mudou: quem entrou e saiu da lista, quem andou um ponto ou mais no índice, quem mudou de preço e quem assumiu o primeiro lugar de cada arena. Se o índice trocou de versão entre as capturas, as notas não se comparam, e a página diz isso em vez de listar movimentos que não existem.

Os gráficos são HTML e SVG estáticos: a página não roda script, e os gráficos chegam a buscador, leitor sem JavaScript e impressão como a tabela. Os dados vêm da API gratuita da Artificial Analysis, que pede atribuição com link onde os números aparecem. O espelho de leaderboard de arena que completava a capa saiu: ele republicava dados de um site cujos termos proíbem raspagem.

**Imagem social:** a maioria das plataformas ignora SVG em `og:image`. O build rasteriza um PNG de cada capa (`scripts/rasterize-covers.mjs`) com Playfair e IBM Plex empacotados, sem depender de fonte do sistema, e grava com paleta de 256 cores: sem a textura de grão, uma capa tem cerca de mil cores e as 256 mais frequentes cobrem 99,9% dos pixels, então o cartão fica igual a olho e cerca de 80% menor.

## O site

Cada rota sai como HTML estático com metadados próprios: título, descrição, canonical, Open Graph, JSON-LD e o conteúdo renderizado no servidor. Só o Pulso da Semana hidrata, porque tem player; o resto não carrega JavaScript além do Google Analytics. Não há página por notícia: o título de cada item leva direto à fonte, e o resumo fica na própria edição, num bloco que abre. `sitemap.xml` lista só o que é indexável. Edições são `noindex, follow`: um arquivo diário feito de resumo de reportagem alheia não deve competir com o que não envelhece — capa, arquivo, modelos e metodologia.

### Portões de CI

O job `site` do CI (`.github/workflows/ci.yml`) monta o site a partir das edições sintéticas de `fixtures/editions` e roda:

- `npm run verify:site`: sobe o site local e confere cada rota, metadado, feed e regra de indexação. O peso da página da edição tem meta de 30 kB gzip, que só gera aviso, e teto de 50 kB, que reprova: o peso segue o noticiário do dia (um dia cheio, com resumos em todos os itens, chega a ~40 kB), a fixture tem 4 kB e não pegaria regressão nenhuma, e travar a edição do dia por 0,1 kB, como em 21/10, é pior que uma página um pouco mais pesada. Só um defeito de template ou de dados passa de 50 kB.
- `npm run budget:bundle`: o JavaScript do Pulso da Semana dentro do orçamento de `budgets.json`, medido pelo grafo de importação estática.
- `npm run a11y`: axe-core sobre jsdom nas rotas servidas, reprovando em `serious`/`critical`. Imprime em toda corrida as regras que **não** puderam rodar: contraste de cor exige layout, e jsdom não renderiza.

O workflow de publicação roda os mesmos três portões sobre as edições reais antes de subir o site.

## Painel de saúde e custo

`npm run health` gera `.tmp/health/index.html`, uma página local com os últimos 30 dias (`--days` vai de 1 a 30):

- **Custo da OpenAI** por etapa, por modelo, por dia e por corrida, o custo por edição publicada e a corrida mais cara diante do teto `PULSO_MAX_EDITION_USD`. É a estimativa da própria cozinha (tokens vezes `backend/src/edition/cost.ts`), não a fatura: tokens em cache não têm o desconto, então ela tende a ficar um pouco acima do cobrado.
- **Corridas** do `publicar.yml`: origem, resultado, duração e o que a cozinha fez.
- **Monitores** do Healthchecks.io, no estado de agora.
- **Disparador**: cada horário do cron do Worker, com o que a Cloudflare não disparou e o que falhou ao pedir a corrida ao GitHub.

O custo vem de um relatório que cada corrida da cozinha grava, inclusive a que falha ou não publica nada, e que o workflow guarda 90 dias como artefato `run-report-N.json` (`backend/src/kitchen/runReport.ts`). Num repositório público, qualquer conta logada no GitHub baixa esse artefato, como já lê o log; por isso ele só leva números, etapas, modelos e status, sem texto de erro.

As credenciais ficam em `.env.health`, que o git ignora (modelo em `.env.health.example`), e são todas só de leitura: um token do GitHub (ou o do `gh`), a chave read-only do Healthchecks e um token da Cloudflare com Account Analytics: Read. Uma fonte sem credencial aparece como "não configurado" e não impede as outras. A página não tem script nem carrega nada de fora, e não há servidor: ela é aberta do disco.

## Medição de audiência

O Pulso usa a mesma propriedade GA4 do `dorly.com.br`. Não há personalização: a capa não muda por visitante. A página de metodologia declara isso.
