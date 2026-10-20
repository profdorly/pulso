import { outletFailures, pipelineWarnings, type NamedFailure } from "../../lib/failures.js";

export function EditionNotes({ failures }: { failures: NamedFailure[] }) {
  const outlets = outletFailures(failures);
  const pipeline = pipelineWarnings(failures);
  if (outlets.length === 0 && pipeline.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {outlets.length > 0 ? (
        <p className="pulso-note">
          Fontes que falharam nesta edição: {outlets.map((item) => item.name).join(", ")}.
        </p>
      ) : null}
      {pipeline.length > 0 ? (
        <p className="pulso-note">
          Checagem desta edição: {pipeline.map((item) => item.name).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
