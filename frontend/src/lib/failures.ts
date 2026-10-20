/** Pipeline steps reuse `sourceFailures` today; they are not outlets. */
const PIPELINE_PREFIX = "pulso-";

export interface NamedFailure {
  sourceId: string;
  name: string;
  error: string;
}

export function outletFailures(failures: NamedFailure[]): NamedFailure[] {
  return failures.filter((failure) => !failure.sourceId.startsWith(PIPELINE_PREFIX));
}

export function pipelineWarnings(failures: NamedFailure[]): NamedFailure[] {
  return failures.filter((failure) => failure.sourceId.startsWith(PIPELINE_PREFIX));
}
