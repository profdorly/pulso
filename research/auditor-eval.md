# Auditor de fidelidade: avaliação medida

Pergunta que este arquivo responde: **a API do provedor é boa o bastante para auditar resumo em
português contra matéria em inglês?** Isso não se responde lendo model card. Responde-se dando ao
auditor resumos cujos defeitos são conhecidos de antemão e contando o que ele pega e o que ele
inventa.

Rodar:

```bash
cd backend
npx tsx src/edition/auditorCli.ts                                        # provedor padrão
PULSO_AUDITOR_PROVIDER=moonshot PULSO_AUDITOR_MODEL=kimi-k3 \
  npx tsx src/edition/auditorCli.ts                                      # família independente
```

Cada execução **anexa** uma seção, para que provedores diferentes possam ser comparados no mesmo
arquivo.

## Como o corpus é construído

21 casos, definidos em `backend/src/edition/auditorEval.ts`. Todos os textos são **sintéticos**:
leem como cobertura real de propósito, porque o auditor precisa funcionar em prosa comum, mas
nenhum caso relata evento real.

**8 casos sem defeito** e **13 com defeito semeado**:

| defeito | o que foi plantado |
| --- | --- |
| `number-swap` | valor ou contagem trocada (4 → 40 dólares; 80 → 180 páginas) |
| `modality-drift` | "planeja lançar" virou "lançou"; minuta em consulta virou regra aprovada |
| `attribution-error` | ressalva da pesquisadora atribuída ao laboratório; fala atribuída a empresa ausente |
| `unsupported-claim` | liderança de mercado e rodada de investimento que não estão no texto |
| `date-drift` | 14 de setembro → outubro; fim deste ano → começo do ano que vem |
| `entity-swap` | Solstice → Solstice 2 |

Metade do corpus não tem defeito **de propósito**. As duas taxas apontam em direções opostas e as
duas têm consequência: detecção baixa publica o que a matéria não sustenta; falso positivo alto
apaga parágrafo bom. Um auditor com 100% de detecção que rejeita metade dos resumos fiéis piora o
produto.

Os dois casos `omission` são o teste que impede o pior desenho possível: um auditor que exija
completude rejeita todo resumo, porque resumo é incompleto por definição.

`modality-drift` é a categoria que justifica o auditor existir. Os outros defeitos — número, data,
versão de modelo — o gate determinístico já pega de graça e sem poder ser convencido do contrário.
"Planeja lançar" contra "lançou" não tem número para comparar, e é exatamente o erro que fica mais
provável agora que o texto do item cresceu de uma frase para dois parágrafos.

Os 6 casos da segunda metade existem porque a primeira metade foi acertada inteira pelo modelo mais
barato da casa. Benchmark que todos passam não mede nada, então foram acrescentados três que
**passam parecendo errados** (mesma informação em outra notação; porta-voz falando pela instituição;
ressalva preservada) e três que **falham de forma sutil** (inferência plausível não escrita; "até
300 páginas" virando "no mínimo 300"; prévia fechada virando produção).

## O que a medição mostrou

**Capacidade não é o gargalo.** `gpt-5.6-luna` — o modelo mais barato do pipeline, US$ 0,20 por 1M
de entrada — acertou **21 de 21**, incluindo os três casos difíceis. Todo caso fiel passou com zero
apontamentos; todo caso com defeito foi rejeitado com 1 ou 2 apontamentos no lugar certo.

Três consequências, e a terceira é a que mais importa:

**O custo do auditor cai uma ordem de magnitude.** A estimativa anterior de ~US$ 0,28 por edição
assumia modelo de fronteira (K3, US$ 3/1M). Se um modelo classe Luna basta, o auditor custa
~US$ 0,02 por edição com corpo real de matéria. Deixa de ser item de orçamento.

**O consumo desta bancada não é o custo de produção.** 11.456 tokens de entrada para 21 casos dá
~545 por caso, porque os corpos sintéticos são curtos. Matéria real tem cerca de 10x isso.

**Esta avaliação NÃO testou o viés que motivou a família independente.** Auto-preferência é um juiz
avaliando a **própria** saída. Os resumos daqui foram escritos à mão, não gerados pelo modelo que
depois os julgou. Ou seja: o corpus mede **capacidade na tarefa**, não **viés**. Medir viés exigiria
gerar os resumos com o modelo escritor — inclusive os defeituosos — e comparar julgamento da mesma
família contra família diferente. Experimento diferente, ainda não feito.

Então o argumento por independência de família continua válido por princípio (e a literatura mostra
que o efeito cresce com a capacidade do juiz), mas ele **não foi confirmado aqui**, e a diferença de
capacidade que justificaria pagar mais **não existe** neste corpus.

## Decisão de provedor: pendente

> **Atualização 2026-10-09: decidido, OpenAI `gpt-6.1-sol` com raciocínio `low`.** O acesso ao
> Bedrock acabou, então o Opus 4.6 saiu. As três medições de 2026-10-09 estão no fim deste arquivo,
> seguidas da comparação numa edição real. O texto abaixo fica como registro do raciocínio de
> agosto.

O auditor precisa ser de **família diferente** da que escreve. Juízes favorecem a própria família,
e o efeito cresce com a capacidade do modelo — então auditar GPT com GPT é estruturalmente fraco em
qualquer tamanho. Por isso a seção `openai` abaixo é o **controle**, não a proposta: ela mede o piso
de detecção e serve para saber se a bancada funciona.

Recomendação em aberto com o dono do projeto: **Amazon Bedrock** (mesma conta da Lambda, autentica
por IAM role em vez de chave guardada, famílias não-OpenAI disponíveis) com **Kimi Platform**
pay-as-you-go como plano B. O endpoint do plano Kimi Code não serve: a própria documentação
direciona "chamar capacidade de modelo no seu produto" para a Kimi Platform.

Com o resultado acima, o critério de escolha muda: como capacidade não diferencia, o que sobra é
operacional. Aí o Bedrock ganha por um motivo concreto e não por preferência — autenticar por IAM
role elimina uma chave de terceiro do Secrets Manager, na mesma conta onde a Lambda já roda.

O piso, se nenhum provedor externo for aprovado: rodar o auditor em modelo classe Luna da própria
OpenAI. É estruturalmente mais fraco por causa do viés de família, mas mede 21/21 aqui e é
incomparavelmente melhor que não auditar. Fica registrado como fallback explícito, não como
recomendação.

---

## openai · `gpt-5.6-luna` · 2026-08-15

Detecção **100%** (13/13 defeitos semeados) · falso positivo **0%** (0/8 resumos fiéis rejeitados)

11456 tokens de entrada, 1874 de saída, 10.9s, 0 resposta(s) inutilizável(is).

| defeito | semeados | pegos |
| --- | --- | --- |
| number-swap | 3 | 3 |
| modality-drift | 2 | 2 |
| attribution-error | 2 | 2 |
| unsupported-claim | 4 | 4 |
| date-drift | 1 | 1 |
| entity-swap | 1 | 1 |

| caso | esperado | auditor | apontamentos | veredito |
| --- | --- | --- | --- | --- |
| `clean-launch` | sustentado | sustentado | 0 | ✅ |
| `clean-policy` | sustentado | sustentado | 0 | ✅ |
| `clean-pt` | sustentado | sustentado | 0 | ✅ |
| `omission-bench` | sustentado | sustentado | 0 | ✅ |
| `omission-policy` | sustentado | sustentado | 0 | ✅ |
| `number-swap-price` | não sustentado | não sustentado | 1 | ✅ |
| `number-swap-pages` | não sustentado | não sustentado | 1 | ✅ |
| `modality-launch` | não sustentado | não sustentado | 1 | ✅ |
| `modality-policy` | não sustentado | não sustentado | 1 | ✅ |
| `attribution-quote` | não sustentado | não sustentado | 1 | ✅ |
| `attribution-company` | não sustentado | não sustentado | 2 | ✅ |
| `unsupported-market` | não sustentado | não sustentado | 2 | ✅ |
| `unsupported-context` | não sustentado | não sustentado | 1 | ✅ |
| `date-drift` | não sustentado | não sustentado | 2 | ✅ |
| `entity-swap` | não sustentado | não sustentado | 1 | ✅ |
| `paraphrase-units` | sustentado | sustentado | 0 | ✅ |
| `spokesperson-institution` | sustentado | sustentado | 0 | ✅ |
| `hedge-preserved` | sustentado | sustentado | 0 | ✅ |
| `inference-cause` | não sustentado | não sustentado | 1 | ✅ |
| `direction-flip` | não sustentado | não sustentado | 1 | ✅ |
| `scope-creep` | não sustentado | não sustentado | 1 | ✅ |

## bedrock · `global.anthropic.claude-opus-4-6-v1` · 2026-08-18

Detecção **100%** (13/13 defeitos semeados) · falso positivo **0%** (0/8 resumos fiéis rejeitados)

14110 tokens de entrada, 1529 de saída, 23.2s, 0 resposta(s) inutilizável(is).

| defeito | semeados | pegos |
| --- | --- | --- |
| number-swap | 3 | 3 |
| modality-drift | 2 | 2 |
| attribution-error | 2 | 2 |
| unsupported-claim | 4 | 4 |
| date-drift | 1 | 1 |
| entity-swap | 1 | 1 |

| caso | esperado | auditor | apontamentos | veredito |
| --- | --- | --- | --- | --- |
| `clean-launch` | sustentado | sustentado | 0 | ✅ |
| `clean-policy` | sustentado | sustentado | 0 | ✅ |
| `clean-pt` | sustentado | sustentado | 0 | ✅ |
| `omission-bench` | sustentado | sustentado | 0 | ✅ |
| `omission-policy` | sustentado | sustentado | 0 | ✅ |
| `number-swap-price` | não sustentado | não sustentado | 1 | ✅ |
| `number-swap-pages` | não sustentado | não sustentado | 1 | ✅ |
| `modality-launch` | não sustentado | não sustentado | 1 | ✅ |
| `modality-policy` | não sustentado | não sustentado | 1 | ✅ |
| `attribution-quote` | não sustentado | não sustentado | 1 | ✅ |
| `attribution-company` | não sustentado | não sustentado | 2 | ✅ |
| `unsupported-market` | não sustentado | não sustentado | 2 | ✅ |
| `unsupported-context` | não sustentado | não sustentado | 1 | ✅ |
| `date-drift` | não sustentado | não sustentado | 2 | ✅ |
| `entity-swap` | não sustentado | não sustentado | 1 | ✅ |
| `paraphrase-units` | sustentado | sustentado | 0 | ✅ |
| `spokesperson-institution` | sustentado | sustentado | 0 | ✅ |
| `hedge-preserved` | sustentado | sustentado | 0 | ✅ |
| `inference-cause` | não sustentado | não sustentado | 1 | ✅ |
| `direction-flip` | não sustentado | não sustentado | 1 | ✅ |
| `scope-creep` | não sustentado | não sustentado | 1 | ✅ |

## openai · `gpt-6.1-sol` · reasoning low · 2026-10-09

Detecção **100%** (13/13 defeitos semeados) · falso positivo **0%** (0/8 resumos fiéis rejeitados)

13010 tokens de entrada, 1360 de saída, 22.3s, 0 resposta(s) inutilizável(is).

| defeito | semeados | pegos |
| --- | --- | --- |
| number-swap | 3 | 3 |
| modality-drift | 2 | 2 |
| attribution-error | 2 | 2 |
| unsupported-claim | 4 | 4 |
| date-drift | 1 | 1 |
| entity-swap | 1 | 1 |

| caso | esperado | auditor | apontamentos | veredito |
| --- | --- | --- | --- | --- |
| `clean-launch` | sustentado | sustentado | 0 | ✅ |
| `clean-policy` | sustentado | sustentado | 0 | ✅ |
| `clean-pt` | sustentado | sustentado | 0 | ✅ |
| `omission-bench` | sustentado | sustentado | 0 | ✅ |
| `omission-policy` | sustentado | sustentado | 0 | ✅ |
| `number-swap-price` | não sustentado | não sustentado | 1 | ✅ |
| `number-swap-pages` | não sustentado | não sustentado | 2 | ✅ |
| `modality-launch` | não sustentado | não sustentado | 1 | ✅ |
| `modality-policy` | não sustentado | não sustentado | 1 | ✅ |
| `attribution-quote` | não sustentado | não sustentado | 1 | ✅ |
| `attribution-company` | não sustentado | não sustentado | 2 | ✅ |
| `unsupported-market` | não sustentado | não sustentado | 2 | ✅ |
| `unsupported-context` | não sustentado | não sustentado | 1 | ✅ |
| `date-drift` | não sustentado | não sustentado | 2 | ✅ |
| `entity-swap` | não sustentado | não sustentado | 1 | ✅ |
| `paraphrase-units` | sustentado | sustentado | 0 | ✅ |
| `spokesperson-institution` | sustentado | sustentado | 0 | ✅ |
| `hedge-preserved` | sustentado | sustentado | 0 | ✅ |
| `inference-cause` | não sustentado | não sustentado | 1 | ✅ |
| `direction-flip` | não sustentado | não sustentado | 2 | ✅ |
| `scope-creep` | não sustentado | não sustentado | 1 | ✅ |

## openai · `gpt-6.1-sol` · reasoning medium · 2026-10-09

Detecção **100%** (13/13 defeitos semeados) · falso positivo **0%** (0/8 resumos fiéis rejeitados)

13010 tokens de entrada, 1479 de saída, 56.1s, 0 resposta(s) inutilizável(is).

| defeito | semeados | pegos |
| --- | --- | --- |
| number-swap | 3 | 3 |
| modality-drift | 2 | 2 |
| attribution-error | 2 | 2 |
| unsupported-claim | 4 | 4 |
| date-drift | 1 | 1 |
| entity-swap | 1 | 1 |

| caso | esperado | auditor | apontamentos | veredito |
| --- | --- | --- | --- | --- |
| `clean-launch` | sustentado | sustentado | 0 | ✅ |
| `clean-policy` | sustentado | sustentado | 0 | ✅ |
| `clean-pt` | sustentado | sustentado | 0 | ✅ |
| `omission-bench` | sustentado | sustentado | 0 | ✅ |
| `omission-policy` | sustentado | sustentado | 0 | ✅ |
| `number-swap-price` | não sustentado | não sustentado | 1 | ✅ |
| `number-swap-pages` | não sustentado | não sustentado | 1 | ✅ |
| `modality-launch` | não sustentado | não sustentado | 1 | ✅ |
| `modality-policy` | não sustentado | não sustentado | 1 | ✅ |
| `attribution-quote` | não sustentado | não sustentado | 1 | ✅ |
| `attribution-company` | não sustentado | não sustentado | 2 | ✅ |
| `unsupported-market` | não sustentado | não sustentado | 2 | ✅ |
| `unsupported-context` | não sustentado | não sustentado | 1 | ✅ |
| `date-drift` | não sustentado | não sustentado | 2 | ✅ |
| `entity-swap` | não sustentado | não sustentado | 1 | ✅ |
| `paraphrase-units` | sustentado | sustentado | 0 | ✅ |
| `spokesperson-institution` | sustentado | sustentado | 0 | ✅ |
| `hedge-preserved` | sustentado | sustentado | 0 | ✅ |
| `inference-cause` | não sustentado | não sustentado | 1 | ✅ |
| `direction-flip` | não sustentado | não sustentado | 1 | ✅ |
| `scope-creep` | não sustentado | não sustentado | 1 | ✅ |

## openai · `gpt-6-luna` · reasoning medium · 2026-10-09

Detecção **100%** (13/13 defeitos semeados) · falso positivo **13%** (1/8 resumos fiéis rejeitados)

13010 tokens de entrada, 2988 de saída, 19.0s, 0 resposta(s) inutilizável(is).

| defeito | semeados | pegos |
| --- | --- | --- |
| number-swap | 3 | 3 |
| modality-drift | 2 | 2 |
| attribution-error | 2 | 2 |
| unsupported-claim | 4 | 4 |
| date-drift | 1 | 1 |
| entity-swap | 1 | 1 |

| caso | esperado | auditor | apontamentos | veredito |
| --- | --- | --- | --- | --- |
| `clean-launch` | sustentado | sustentado | 0 | ✅ |
| `clean-policy` | sustentado | sustentado | 0 | ✅ |
| `clean-pt` | sustentado | sustentado | 0 | ✅ |
| `omission-bench` | sustentado | sustentado | 0 | ✅ |
| `omission-policy` | sustentado | sustentado | 0 | ✅ |
| `number-swap-price` | não sustentado | não sustentado | 1 | ✅ |
| `number-swap-pages` | não sustentado | não sustentado | 1 | ✅ |
| `modality-launch` | não sustentado | não sustentado | 1 | ✅ |
| `modality-policy` | não sustentado | não sustentado | 2 | ✅ |
| `attribution-quote` | não sustentado | não sustentado | 1 | ✅ |
| `attribution-company` | não sustentado | não sustentado | 2 | ✅ |
| `unsupported-market` | não sustentado | não sustentado | 2 | ✅ |
| `unsupported-context` | não sustentado | não sustentado | 1 | ✅ |
| `date-drift` | não sustentado | não sustentado | 2 | ✅ |
| `entity-swap` | não sustentado | não sustentado | 1 | ✅ |
| `paraphrase-units` | sustentado | não sustentado | 1 | ❌ |
| `spokesperson-institution` | sustentado | sustentado | 0 | ✅ |
| `hedge-preserved` | sustentado | sustentado | 0 | ✅ |
| `inference-cause` | não sustentado | não sustentado | 1 | ✅ |
| `direction-flip` | não sustentado | não sustentado | 1 | ✅ |
| `scope-creep` | não sustentado | não sustentado | 1 | ✅ |

## Troca do Opus 4.6 pelo GPT-6.1 Sol numa edição real · 2026-10-09

O corpus acima não separa os candidatos: Opus 4.6 e GPT-6.1 Sol acertam 21 de 21, e o `medium`
do Sol só custa 2,5 vezes o tempo do `low`. O GPT-6 Luna errou um caso fiel (`paraphrase-units`)
e, além disso, é o modelo que escreve título, blurb e resumo: auditar com ele seria autoavaliação.

A comparação que decide é com texto real. Os 50 itens de uma edição local (2026-10-09) foram
reauditados pelo Sol `low` com as páginas baixadas de novo pela própria verificação de link, e o
veredito de cada item foi comparado com o que o Opus 4.6 fez na mesma edição (texto mantido ou
removido).

| | Opus 4.6 (Bedrock) | GPT-6.1 Sol `low` |
| --- | --- | --- |
| Itens com página auditados | 43 | 43 |
| Vereditos ilegíveis | 3 | 0 |
| Itens sem página (site bloqueia robô) | 7 removidos sem auditoria | 7 auditados pelo resumo do feed, 7 aprovados |
| Concordância item a item | — | 36 de 43 |
| Custo da auditoria | US$ 0,68 | US$ 0,23 |
| Tempo (3 em paralelo) | 37 s | 42 s |

As 7 divergências, lidas uma a uma contra a matéria e o resumo do feed:

- **5 textos que o Opus removeu e o Sol aprovou**, todos sustentados pelo resumo do feed ou pela
  página: 3 eram vereditos ilegíveis do Opus; 2 eram blurbs fiéis ao resumo do feed reprovados
  porque a página extraída não trazia o texto da matéria.
- **1 deriva de modalidade que o Opus deixou passar** (The Verge, SpaceXAI e Omarchy): a matéria
  diz que foi *anunciado* que a empresa entraria na fundação e doaria os tokens; o resumo dizia que
  ela *entrou* e *doou*. É exatamente a categoria que justifica o auditor existir.
- **1 caso discutível** (IEEE Spectrum): o blurb dizia que o setor nuclear adota IA "até nas salas
  de controle"; a introdução da matéria cita a sala de controle como o lugar onde IA pareceria
  proibida, e a página extraída não traz o resto. O Sol removeu.

Duas mudanças vieram da mesma comparação. **O resumo do feed entra na evidência**: título e blurb
são escritos a partir dele, e sem ele o Sol reprovou 10 textos que passaram quando o resumo foi
incluído; em 5 deles a página extraída era só CSS e menu. **Página que não abre não apaga mais o
item sem auditoria**: título e blurb são julgados contra o título e o resumo do feed, e só o
parágrafo sai.

Ressalva que continua valendo: Sol e Luna são da mesma empresa. Ao contrário do corpus, esta
comparação usa texto escrito pelo modelo de produção, mas ainda não mede viés de família; ela mede
que, nesta tarefa, o Sol foi mais estrito que o Opus onde a matéria não sustentava o texto, e não
mais leniente.
