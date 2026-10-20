import {
  METRIC_DISPLAY,
  MODALITY_LABEL,
  type CatalogChanges as Changes,
  type ChangedModel,
  type MetricKey,
} from "../../lib/modelCatalog.js";
import { formatEditionDate } from "../../lib/formatPt.js";

/**
 * "O que mudou" since the previous weekly capture. The kitchen decides what counts as a change
 * (`backend/src/models/changes.ts`); this only says it in words.
 */

function names(models: ChangedModel[]): string {
  return models.map((model) => model.name).join(", ");
}

/** How a move reads in a sentence; the table's short column labels do not. */
const MOVE_LABEL: Partial<Record<MetricKey, string>> = {
  "intelligence-index": "índice de inteligência",
  "price-input-1m": "preço de entrada (por 1M tokens)",
  "price-output-1m": "preço de saída (por 1M tokens)",
};

function formatMove(metric: MetricKey, value: number): string {
  const display = METRIC_DISPLAY[metric];
  return display.nature === "price" ? `US$ ${value.toFixed(display.decimals)}` : value.toFixed(display.decimals);
}

export function CatalogChanges({ changes }: { changes: Changes }) {
  const since = formatEditionDate(changes.since.slice(0, 10));
  const nothing =
    changes.entered.length === 0 && changes.left.length === 0 && changes.moved.length === 0 && changes.leaders.length === 0;

  return (
    <section className="pulso-panel pulso-quiet pulso-changes" aria-labelledby="o-que-mudou">
      <h2 id="o-que-mudou" className="pulso-models-title">
        O que mudou desde {since}
      </h2>
      {!changes.comparable ? (
        <p className="pulso-note">
          A Artificial Analysis mudou a versão do índice de inteligência
          {changes.indexVersions?.before && changes.indexVersions.after
            ? ` (v${changes.indexVersions.before} → v${changes.indexVersions.after})`
            : ""}
          . As notas desta captura não se comparam com as da anterior; só preços entram na lista abaixo.
        </p>
      ) : null}
      {nothing ? (
        <p className="mt-3">Nada que mereça nota: mesma lista, mesmas notas, mesmos preços.</p>
      ) : (
        <ul className="pulso-changes-list">
          {changes.entered.length > 0 ? (
            <li>
              <strong>Entraram na lista:</strong> {names(changes.entered)}
            </li>
          ) : null}
          {changes.left.length > 0 ? (
            <li>
              <strong>Saíram da lista:</strong> {names(changes.left)}
            </li>
          ) : null}
          {changes.moved.map((move) => (
            <li key={`${move.id}-${move.metric}`}>
              <strong>{move.name}</strong>: {MOVE_LABEL[move.metric] ?? METRIC_DISPLAY[move.metric].label.toLowerCase()} de{" "}
              {formatMove(move.metric, move.before)} para {formatMove(move.metric, move.after)}
            </li>
          ))}
          {changes.leaders.map((leader) => (
            <li key={leader.modality}>
              <strong>{MODALITY_LABEL[leader.modality]}:</strong> {leader.after.name} passou {leader.before.name} no
              primeiro lugar
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
