import { usePreloadedEditionData, useEditionResource } from "../lib/editionData.js";
import {
  AA_HOME_URL,
  GROUP_LABEL,
  METRIC_DISPLAY,
  MODALITY_LABEL,
  fetchModelCatalog,
  groupsWithData,
  observationFor,
  rankBy,
  sectionsInGroup,
  type MetricKey,
  type ModelCatalog,
  type ModelRecord,
} from "../lib/modelCatalog.js";
import { bestOfEachFamily } from "../lib/modelPicks.js";
import { formatCapturedAt } from "../lib/formatPt.js";
import { BarList, type BarRow } from "../components/pulso/BarList.js";
import { CatalogChanges } from "../components/pulso/CatalogChanges.js";
import { CatalogTable } from "../components/pulso/CatalogTable.js";
import { ModelPicks } from "../components/pulso/ModelPicks.js";
import { PriceMap } from "../components/pulso/PriceMap.js";

/**
 * /modelos: what changed this week, ready answers, three charts, then every table.
 *
 * Everything renders on the server as HTML and SVG — the page runs no script, so the charts
 * reach search engines, no-JS readers and print the same as the tables.
 */

const BAR_LIMIT = 10;

function bars(models: readonly ModelRecord[], metric: MetricKey, display: (value: number) => string): BarRow[] {
  return bestOfEachFamily(rankBy([...models], metric).ranked)
    .slice(0, BAR_LIMIT)
    .map((model) => {
      const value = observationFor(model, metric)!.value;
      return { id: model.id, label: model.name, value, display: display(value) };
    });
}

export function ModelsPage() {
  const preloaded = usePreloadedEditionData();
  const { data: catalog, error } = useEditionResource<ModelCatalog>(
    preloaded?.catalog ?? null,
    fetchModelCatalog,
    []
  );

  if (error) return <p className="text-base text-muted">{error}</p>;
  if (!catalog) return <p className="text-base text-muted">Carregando os modelos…</p>;

  const groups = groupsWithData(catalog);
  const language = catalog.sections.find((section) => section.modality === "language")?.models ?? [];
  const intelligence = bars(language, "intelligence-index", (value) => value.toFixed(1));
  const speed = bars(language, "output-tokens-per-second", (value) => value.toFixed(0));

  return (
    <article className="pulso-page">
      <header className="pulso-page-header">
        <p className="pulso-meta">Medido em {formatCapturedAt(catalog.capturedAt)}</p>
        <h1 className="pulso-title mt-3">Modelos</h1>
        <p className="pulso-lede mt-4">
          Cada número aqui tem fonte, método e data. Não existe nota única de “melhor modelo”:
          índice de capacidade, preço, velocidade e preferência humana medem coisas diferentes e
          não se somam.
        </p>
        {catalog.sources.length > 0 ? (
          <p className="pulso-note mt-3">
            Dados da{" "}
            <a className="pulso-link" href={AA_HOME_URL}>
              Artificial Analysis
            </a>
            , capturados toda segunda-feira.
          </p>
        ) : null}
      </header>

      {groups.length === 0 ? (
        <p className="text-base text-muted">
          Nenhuma modalidade retornou dados nesta captura. A página volta a listar modelos na
          próxima coleta.
        </p>
      ) : null}

      {catalog.changes ? <CatalogChanges changes={catalog.changes} /> : null}

      {language.length > 0 ? (
        <>
          <ModelPicks models={language} />
          <section aria-labelledby="graficos" className="flex flex-col gap-4">
            <h2 id="graficos" className="pulso-section-title">
              Em gráficos
            </h2>
            <p className="max-w-[65ch]">
              Cada modelo aparece uma vez, na sua melhor configuração. A tabela abaixo lista todas.
            </p>
            <div className="pulso-charts">
              <BarList
                title={`${METRIC_DISPLAY["intelligence-index"].label}: os ${intelligence.length} maiores`}
                note="Índice da Artificial Analysis; quanto maior, melhor."
                rows={intelligence}
              />
              <BarList
                title={`${METRIC_DISPLAY["output-tokens-per-second"].label}: os ${speed.length} mais rápidos`}
                note={`Entre os ${language.length} modelos de maior índice; tokens por segundo na resposta, mediana medida.`}
                rows={speed}
              />
            </div>
            <PriceMap models={language} />
          </section>
        </>
      ) : null}

      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-8" aria-labelledby={`grupo-${group}`}>
          <div>
            <h2 id={`grupo-${group}`} className="pulso-section-title">
              {GROUP_LABEL[group]}
            </h2>
            {group === "texto" ? (
              <p className="mt-3 max-w-[65ch]">
                Índices vêm de avaliações executadas; preço é tabela do provedor; velocidade é
                mediana medida. Colunas com “—” são dados que a fonte não publica para aquele
                modelo.
              </p>
            ) : (
              <p className="mt-3 max-w-[65ch]">
                Aqui só existe <strong>preferência humana</strong>: pessoas comparando pares de
                resultados. Não é capacidade medida, e o Elo de uma arena não se compara com o de
                outra nem com os índices da linha de texto. O valor após “±” é o intervalo de
                confiança de 95%. Quando ele encosta no do vizinho, a diferença não é conclusiva.
              </p>
            )}
          </div>

          {sectionsInGroup(catalog, group).map((section) => (
            <section key={section.modality} className="flex flex-col gap-4">
              <h3 className="pulso-kicker">{MODALITY_LABEL[section.modality]}</h3>
              <CatalogTable section={section} catalog={catalog} />
            </section>
          ))}
        </section>
      ))}
    </article>
  );
}
