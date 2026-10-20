import { modelPicks, splitModelLabel } from "../../lib/modelPicks.js";
import type { ModelRecord } from "../../lib/modelCatalog.js";

/** The four ready lists at the top of /modelos. Each states its rule; the table has the rest. */
export function ModelPicks({ models }: { models: readonly ModelRecord[] }) {
  const lists = modelPicks(models);
  if (lists.length === 0) return null;
  return (
    <section aria-labelledby="atalhos" className="flex flex-col gap-4">
      <h2 id="atalhos" className="pulso-section-title">
        Atalhos
      </h2>
      <div className="pulso-picks">
        {lists.map((list) => (
          <section key={list.id} className="pulso-panel pulso-models" aria-labelledby={`atalho-${list.id}`}>
            <h3 id={`atalho-${list.id}`} className="pulso-models-title">
              {list.title}
            </h3>
            <p className="pulso-note">{list.rule}</p>
            <ol className="pulso-rank">
              {list.picks.map((pick, index) => {
                const { name, variant } = splitModelLabel(pick.model.name);
                return (
                  <li key={pick.model.id}>
                    <span className="pulso-rank-pos">{index + 1}</span>
                    <p className="pulso-rank-name">
                      {name}
                      <span>{variant ? `${pick.model.creator} · ${variant}` : pick.model.creator}</span>
                    </p>
                    <p className="pulso-pick-value">{pick.display}</p>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
