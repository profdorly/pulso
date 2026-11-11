import { Link } from "react-router-dom";
import type { PulsoEdition } from "../../lib/edition.js";
import { formatCapturedAt } from "../../lib/formatPt.js";
import {
  AA_HOME_URL,
  formatObservation,
  observationFor,
  type ModelCatalog,
} from "../../lib/modelCatalog.js";
import { rankByFamily, splitModelLabel } from "../../lib/modelPicks.js";

/** Rows on the cover card. The edition carries five; the table on /modelos carries the rest. */
const RANK_LENGTH = 5;

type StripRow = PulsoEdition["benchmarks"]["headline"][number];

function metricOf(row: StripRow): string {
  return row.metric ?? "Índice de inteligência";
}

/** The credit line, with the link the Artificial Analysis free API asks for. */
function Credit({ names }: { names: string[] }) {
  return (
    <>
      {names.map((name, index) => (
        <span key={name}>
          {index > 0 ? " e " : null}
          {name === "Artificial Analysis" ? (
            <a className="pulso-link" href={AA_HOME_URL}>
              {name}
            </a>
          ) : (
            name
          )}
        </span>
      ))}
    </>
  );
}

function catalogRows(catalog: ModelCatalog): StripRow[] {
  const language = catalog.sections.find((section) => section.modality === "language")?.models ?? [];
  return rankByFamily(language, "intelligence-index")
    .slice(0, RANK_LENGTH)
    .map((model) => ({
      label: model.name,
      value: formatObservation(observationFor(model, "intelligence-index")),
      delta: null,
      metric: "Índice de inteligência",
    }));
}

export function ModelsStrip({
  edition,
  catalog,
}: {
  edition: PulsoEdition;
  /** Current catalogue on the cover; omitted on dated editions, which keep their historical snapshot. */
  catalog?: ModelCatalog | null;
}) {
  const rows = catalog ? catalogRows(catalog) : edition.benchmarks.headline.slice(0, RANK_LENGTH);
  const capturedAt = catalog?.capturedAt ?? edition.benchmarks.capturedAt;
  const attribution = catalog
    ? catalog.sources.map((source) => source === "artificial-analysis" ? "Artificial Analysis" : source)
    : edition.benchmarks.attribution;
  const metrics = [...new Set(rows.map(metricOf))];
  // One metric for the whole list is stated once in the header instead of under every number.
  const sharedMetric = metrics.length === 1 ? metrics[0] : null;

  return (
    <section className="pulso-panel pulso-models" aria-labelledby="modelos-capa">
      <h2 id="modelos-capa" className="pulso-models-title">
        Modelos
      </h2>
      {sharedMetric ? <p className="pulso-note">{sharedMetric}, do maior para o menor</p> : null}
      {rows.length === 0 ? (
        <p className="pulso-note mt-4">Ainda sem medição nesta capa.</p>
      ) : (
        <ol className="pulso-rank">
          {rows.map((row, index) => {
            const { name, variant } = splitModelLabel(row.label);
            return (
              <li key={row.label}>
                <span className="pulso-rank-pos">{index + 1}</span>
                <p className="pulso-rank-name">
                  {name}
                  {variant ? <span>{variant}</span> : null}
                  {sharedMetric ? null : <span>{metricOf(row)}</span>}
                </p>
                <p className="pulso-rank-value">{row.value}</p>
              </li>
            );
          })}
        </ol>
      )}
      <div className="pulso-models-foot">
        {attribution.length > 0 ? (
          <p className="pulso-note">
            <Credit names={attribution} />, medido em {formatCapturedAt(capturedAt)}
          </p>
        ) : null}
        <Link to="/modelos/" className="pulso-action">
          Ver tabela completa
        </Link>
      </div>
    </section>
  );
}
