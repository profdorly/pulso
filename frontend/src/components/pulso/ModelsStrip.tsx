import { Link } from "react-router-dom";
import type { PulsoEdition } from "../../lib/edition.js";
import { formatCapturedAt } from "../../lib/formatPt.js";
import { AA_HOME_URL } from "../../lib/modelCatalog.js";
import { splitModelLabel } from "../../lib/modelPicks.js";

/** Rows on the cover card. The edition carries five; the table on /modelos carries the rest. */
const RANK_LENGTH = 5;

function metricOf(row: PulsoEdition["benchmarks"]["headline"][number]): string {
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

export function ModelsStrip({ edition }: { edition: PulsoEdition }) {
  const rows = edition.benchmarks.headline.slice(0, RANK_LENGTH);
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
        {edition.benchmarks.attribution.length > 0 ? (
          <p className="pulso-note">
            <Credit names={edition.benchmarks.attribution} />, medido em {formatCapturedAt(edition.benchmarks.capturedAt)}
          </p>
        ) : null}
        <Link to="/modelos/" className="pulso-action">
          Ver tabela completa
        </Link>
      </div>
    </section>
  );
}
