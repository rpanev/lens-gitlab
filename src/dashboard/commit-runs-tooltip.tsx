import { Div, Span } from "@k8slens/element-components";
import { runStatusOf } from "../pipelines/run-status";
import type { Pipeline } from "../pipelines/pipeline";
import { RunStatusIcon } from "./run-status-icon";

export const CommitRunsTooltip = ({
  runs,
  runsOn,
  others = 0,
}: {
  runs: readonly Pipeline[];
  runsOn?: string;
  /** How many runs it did not start were recorded against it too. */
  others?: number;
}) => (
  <Div $flex={{ direction: "vertical", gap: "xs" }}>
    {runsOn && <Span $color="textMuted">Runs of the tagged commit on {runsOn}</Span>}
    {runs.map((run) => {
      const status = runStatusOf(run);

      return (
        <Div key={run.databaseId} $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}>
          <RunStatusIcon status={status} />
          <Span>{run.name}</Span>
          <Span $color="textMuted">{status.label}</Span>
        </Div>
      );
    })}
    {others > 0 && (
      <Span $color="textMuted">
        +{others} {others === 1 ? "run" : "runs"} not started by it
      </Span>
    )}
  </Div>
);
