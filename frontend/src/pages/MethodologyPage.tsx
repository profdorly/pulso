import { Link } from "react-router-dom";
import { CONTACT_EMAIL } from "../lib/siteBase.js";
import { publicAssetUrl } from "../lib/paths.js";
import { CorrectionLink } from "../components/pulso/CorrectionLink.js";

/**
 * How the thing works, in the reader's language.
 *
 * Everything described here is enforced in code and covered by tests; this page exists
 * because a mechanism nobody can see does not build trust. It is also the page that states
 * the limits — what is not checked, and what a number does not mean — since a claim of
 * total accuracy would be the least credible thing the site could say.
 */
export function MethodologyPage() {
  return (
    <article className="pulso-page mx-auto w-full max-w-4xl">
      <header className="pulso-page-header">
        <p className="pulso-kicker">Como funciona</p>
        <h1 className="pulso-title mt-3">Metodologia</h1>
        <p className="pulso-lede mt-4">
          O Pulso é montado por um programa, uma vez por dia, sem ninguém revisando antes de
          publicar. A corrida é às 07:30, horário de Brasília, e cobre as 24 horas anteriores: o
          dia americano de ontem já publicado, o dia asiático fechado e a Europa em andamento. As
          regras precisam estar à vista, e principalmente o que o programa não garante.
        </p>
      </header>

      <Section title="O que o Pulso é">
        <p>
          O Pulso não apura. Cada item aponta para quem noticiou, com o nome do veículo à vista.
          Se a origem errou, o erro chega aqui. O que sai é seleção, um resumo em português e o
          caminho até a matéria.
        </p>
        <p>
          O título sai em português quando a tradução passa no gate. Se não passou, permanece o
          original do veículo, e ele é o link para a matéria. A frase curta sai desse título. O
          resumo, que abre logo abaixo dela, sai do corpo da matéria que a verificação já baixou,
          sem número, data ou nome que não esteja nessa página. Um item sem resumo ainda publica,
          com título, link e a frase.
        </p>
      </Section>

      <Section title="De onde vêm os itens">
        <p>
          Duas entradas: feeds dos laboratórios e da imprensa especializada, e uma busca que
          procura o que não apareceu em feed. Cada edição olha apenas a janela desde a última capa
          que trouxe notícia — na primeira corrida, as 30 horas anteriores. Um mesmo link nunca é
          publicado duas vezes.
        </p>
        <p>
          Há um teto de 50 itens por edição. Num dia com mais do que isso, ficam de fora os itens
          de menor prioridade pelas regras abaixo.
        </p>
      </Section>

      <Section title="Como a capa é escolhida">
        <p>
          Ordenar por recência enche a edição de veículos brasileiros de tech geral: eles
          publicam mais, e na hora da corrida em São Paulo o item local pode ter minutos de vida
          enquanto o do SCMP já tem horas. Os dois vieses apontam para o mesmo lugar.
        </p>
        <p>
          Anúncio de laboratório fica fora da cota por continente: o anúncio é o fato. Ele ainda
          passa pelo filtro de IA — post oficial que não é notícia de IA fica de fora. A imprensa
          é distribuída entre Brasil, EUA, Europa e Ásia. Um mesmo veículo de imprensa entra no
          máximo três vezes. Reportagem entra antes de opinião; o que muda regra, capital, produto
          ou risco entra antes de recapitulativo; recência só desempata. Opinião leva etiqueta
          visível.
        </p>
        <p>
          Na página da edição, os cinco destaques abrem como Prioridades. O restante vai para o
          Radar, ainda em Imprensa e Direto dos labs. Ao lado de cada veículo aparece o
          continente da redação — Olhar Digital · Brasil, TechCrunch · EUA. A cota escolhe quem
          entra. Matéria internacional de um veículo daqui fica na Imprensa.
        </p>
        <p>
          Se a mesma história chega duas vezes, fica a fonte original, mas só quando o Pulso leu
          as duas páginas. Linkar uma origem que não deu para abrir seria publicar um resumo
          impossível de conferir.
        </p>
      </Section>

      <Section title="O que é verificado antes de publicar">
        <p>
          <strong>Todo link é aberto.</strong> Sai da edição o que responde 404, o que cai na
          home do veículo em vez da matéria, o que tem título divergente do prometido e o que
          aponta para outro host. Falha transitória — tempo esgotado, bloqueio de robô, erro do
          servidor — não elimina o item: ele volta na próxima corrida, até três tentativas.
        </p>
        <p>
          <strong>Alegações de risco são checadas contra a fonte.</strong> Valores em dinheiro,
          porcentagens, números precisos e versões de modelo são comparados com o texto da página
          que a verificação de link já baixou. Alegação sem suporte na fonte é removida; se a
          manchete ou a abertura dependiam dela, o texto volta para uma versão montada apenas com
          os títulos originais.
        </p>
        <p>
          <strong>Cada texto gerado passa por uma segunda leitura.</strong> A checagem de números não
          vê que “lançou” foi escrito onde a matéria dizia “planeja lançar”, nem que uma fala foi
          pinçada para a empresa errada. Outro modelo lê o título em português, o blurb e o
          parágrafo contra o texto da página e o resumo que o veículo publica no feed, que é de
          onde o título e o blurb saem. Quem escreve esses textos é o GPT-6 Luna; quem audita é o
          GPT-6.1 Sol, outro modelo, e a edição avisa quando o auditor julgou um texto que ele mesmo
          revisou. O veredito é por item: uma frase ruim não apaga a capa. Se um trecho não se
          sustenta, sai o campo onde ele está; se o veredito não dá para ler, o item perde o texto
          em português e fica com o título original e o link. Quando a página não abre, título e
          blurb são conferidos contra o resumo do feed e o parágrafo não é publicado. Se a
          auditoria for pulada por teto de gasto, os textos saem do mesmo jeito.
        </p>
        <p>
          Conteúdo que vem de fora — feed ou página — é tratado como não
          confiável. Se um texto de terceiro contiver instruções destinadas ao modelo, elas não
          mudam o resultado: item cuja URL não está na edição é descartado no código, não no
          pedido ao modelo.
        </p>
      </Section>

      <Section title="O que não é verificado">
        <p>
          Prosa, enquadramento e juízo editorial. A auditoria confere se o resumo é fiel à
          matéria; não julga se a seleção do dia foi a melhor, nem se a ênfase de uma frase é
          justa. Também não reapura o que o veículo publicou.
        </p>
        <p>
          O Pulso não promete acurácia absoluta. Promete que afirmação de risco sem suporte na
          fonte não vai ao ar, que o resumo passa por essa segunda leitura, e que na dúvida o
          parágrafo sai em vez de arriscar.
        </p>
      </Section>

      <Section title="Quando não há nada para publicar">
        <p>
          Se nada sobrevive à verificação, o Pulso não inventa edição. Se a capa anterior ainda é
          recente, ela continua no ar. Se já passou de 24 horas, sai uma{" "}
          <strong>edição silenciosa</strong>: uma capa que diz o que foi checado e por que nada
          entrou. Uma capa velha nunca é apresentada como atual.
        </p>
      </Section>

      <Section title="Os números dos modelos">
        <p>
          Na página de <Link to="/modelos/" className="pulso-link">modelos</Link>{" "}
          não existe nota única de “melhor modelo”. Capacidade medida, preço de tabela, velocidade
          medida e preferência humana vêm de metodologias diferentes e não se somam; cada número
          carrega fonte, benchmark, versão da suíte quando existe, e data de captura.
        </p>
        <p>
          Imagem e vídeo têm <strong>apenas preferência humana</strong>, com o intervalo de
          confiança de 95% à vista, porque é só isso que a fonte publica para essas modalidades.
          Elo de uma arena não se compara com o de outra.
        </p>
        <p>
          Dado que a fonte não publica aparece como “—”, nunca como zero. Tratar preço ausente
          como zero colocaria modelo sem preço no topo de “mais barato”, que seria o erro mais
          caro dessa página. Publicamos um recorte por modalidade — os 30 modelos de texto de
          maior índice e os 20 de cada arena — e a página diz quantos a fonte mediu, para que
          nenhuma ordenação seja lida como afirmação sobre o mercado inteiro.
        </p>
      </Section>

      <Section title="Erros e correções">
        <p>
          Erro de curadoria é corrigido na edição seguinte; edições passadas ficam no{" "}
          <Link to="/arquivo/" className="pulso-link">arquivo</Link>{" "}
          como foram publicadas, e uma republicação preserva a versão anterior em vez de
          sobrescrevê-la. Sem revisão humana no meio, quem lê é o principal canal de correção.
        </p>
        {CONTACT_EMAIL ? (
          <p>
            Achou um número errado ou um link para a matéria errada? Escreva — não há prazo de
            resposta prometido aqui, porque não há fila nem turno atrás deste endereço.
          </p>
        ) : null}
        <CorrectionLink label="Escrever ao Pulso" />
      </Section>

      <Section title="Audiência">
        <p>
          Cada página carrega o Google Analytics 4, a mesma propriedade do restante de
          dorly.com.br, e nenhum outro script. Serve para contar visita, caminho, origem, clique na fonte e
          compartilhamento. Não muda o texto da edição: a capa que você vê é a que todo mundo vê.
          Há um feed RSS em{" "}
          <a href={publicAssetUrl("feed.xml")} className="pulso-link">
            /feed.xml
          </a>
          .
        </p>
        <p>As famílias tipográficas são hospedadas no próprio domínio.</p>
      </Section>

      <Section title="Transparência de operação">
        <p>
          Cada edição publica quais modelos escreveram o texto, o custo aproximado da corrida
          detalhado por etapa, e as fontes que falharam naquela captura. Cada corrida tem teto de
          gasto: ao alcançá-lo, as etapas de modelo que faltam são puladas e a edição sai com o
          que já tem, com o motivo registrado.
        </p>
        <p>
          O código que monta o Pulso é aberto, e cada corrida fica registrada no repositório, com o
          que entrou, o que caiu e quanto custou.
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <h2 id={id} className="pulso-section-title">
        {title}
      </h2>
      <div className="pulso-prose pulso-prose--compact">{children}</div>
    </section>
  );
}
