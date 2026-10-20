import {
  METRIC_DISPLAY,
  coverageFor,
  formatObservation,
  observationFor,
  rankBy,
  type MetricKey,
  type ModalitySection,
  type ModelCatalog,
} from "../../lib/modelCatalog.js";

/**
 * One modality, one table.
 *
 * Every published model is rendered: the publisher already caps the artifact to what this
 * page shows, so there is no hidden tail the reader is told about but cannot reach. Missing
 * data shows as an em dash, never as zero, and the footer says how many models each column
 * actually covers — so a reader can tell "cheapest" from "cheapest among those with a
 * published price". Column headers carry the unit and the source.
 */

/** Metric used to order each modality, when it has one. */
function primaryMetric(section: ModalitySection): MetricKey | undefined {
  const preferred: MetricKey[] = ["intelligence-index", "arena-elo"];
  return preferred.find((metric) => section.availableMetrics.includes(metric));
}

/** Stable column order so the table does not reshuffle between captures. */
const COLUMN_ORDER: MetricKey[] = [
  "intelligence-index",
  "coding-index",
  "agentic-index",
  "arena-elo",
  "price-input-1m",
  "price-output-1m",
  "output-tokens-per-second",
  "time-to-first-token",
  "end-to-end-latency",
];

export function CatalogTable({
  section,
  catalog,
}: {
  section: ModalitySection;
  catalog: ModelCatalog;
}) {
  const columns = COLUMN_ORDER.filter((metric) => section.availableMetrics.includes(metric));
  const ordering = primaryMetric(section);
  // Models with no number on the ordering axis go last rather than vanishing from the table.
  const ranking = ordering ? rankBy(section.models, ordering) : null;
  const shown = ranking ? [...ranking.ranked, ...ranking.withoutData] : section.models;

  if (shown.length === 0) {
    return <p className="text-base text-muted">Sem dados nesta modalidade nesta captura.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="pulso-table-wrap">
        <table className="pulso-table min-w-[40rem]">
          <caption className="sr-only">
            Modelos de {section.modality}, ordenados por {ordering ? METRIC_DISPLAY[ordering].label : "nome"}
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Modelo</th>
              <th scope="col">Lab</th>
              {columns.map((metric) => {
                const { label, unit } = METRIC_DISPLAY[metric];
                return (
                  <th key={metric} scope="col">
                    {label}
                    {/* "Preferência (Elo)" already names its unit; repeating it underneath was noise. */}
                    {unit && !label.includes(unit) ? <span>{unit}</span> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((model, index) => (
              <tr key={model.id}>
                <td className="pulso-table-num text-muted">{index + 1}</td>
                <th scope="row">{model.name}</th>
                <td className="text-muted">{model.creator}</td>
                {columns.map((metric) => {
                  const observation = observationFor(model, metric);
                  return (
                    <td
                      key={metric}
                      className="pulso-table-num"
                      title={
                        observation
                          ? `${observation.benchmark}${
                              observation.benchmarkVersion ? ` v${observation.benchmarkVersion}` : ""
                            }`
                          : "sem dado publicado pela fonte"
                      }
                    >
                      {formatObservation(observation)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-1">
        {columns.map((metric) => {
          const coverage = coverageFor(catalog, section.modality, metric);
          if (!coverage || coverage.withData === coverage.total) return null;
          return (
            <li key={metric} className="pulso-note">
              {METRIC_DISPLAY[metric].label}: {coverage.withData} de {coverage.total} modelos têm esse
              dado publicado. Os demais aparecem com “—”.
            </li>
          );
        })}
        {section.totalAvailable > section.models.length ? (
          <li className="pulso-note">
            A fonte mediu {section.totalAvailable} modelos nesta modalidade; publicamos os{" "}
            {section.models.length} com maior{" "}
            {ordering ? METRIC_DISPLAY[ordering].label.toLowerCase() : "valor"}. Ordenações de preço
            e velocidade valem dentro desse recorte, não sobre o mercado inteiro.
          </li>
        ) : null}
        {section.notes.map((note) => (
          <li key={note} className="pulso-note">
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}
