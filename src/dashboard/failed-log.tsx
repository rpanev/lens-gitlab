import { A, Div, Pre, Span } from "@k8slens/element-components";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { useEffect } from "react";
import { failedLogInjectable } from "../pipelines/failed-log.injectable";
import { openVersionInjectable } from "../pipelines/open-version.injectable";
import type { RunJob } from "../pipelines/run-jobs";

const logColors = { error: "critical", warning: "warning", plain: undefined } as const;

/** The end of a failed job's log, asked for once when shown. */
export const FailedLog = observer(({ host, project, job }: { host: string; project: string; job: RunJob }) => {
  const log = useInject(failedLogInjectable)(host, project, job.databaseId);
  const openLink = useInject(openVersionInjectable)();
  const { state } = log;

  useEffect(() => void log.load(), [log]);

  return (
    <Div $flex={{ direction: "vertical", gap: "xs" }}>
      {state.status === "loading" && <Span $color="textMuted">Loading the log…</Span>}
      {state.status === "failed" && (
        <Span $color="warning" $tooltip={state.problem.detail}>
          Could not read the log: {state.problem.title}
        </Span>
      )}
      {state.status === "loaded" && (
        <Pre
          $backgroundColor="backgroundPrimary"
          $padding="m"
          $border={{ color: "borderPrimary", width: "xxs", radius: "m" }}
          $overflow={{ x: "auto" }}
          $style={{ maxHeight: 360, margin: 0, fontSize: "0.85em" }}
        >
          {state.lines.map((line, index) => (
            <Span key={index} $color={logColors[line.kind]} $block>
              {line.text}
            </Span>
          ))}
        </Pre>
      )}
      <A onClick={() => void openLink({ url: job.url })} $color="link">
        Full log on GitLab
      </A>
    </Div>
  );
});
