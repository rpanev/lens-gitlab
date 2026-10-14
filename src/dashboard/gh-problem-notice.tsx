import { A, Div, Span } from "@k8slens/element-components";
import { useInject } from "@k8slens/use-inject";
import type { GlabProblem } from "../workflow-runs/glab-problems";
import { openVersionInjectable } from "../workflow-runs/open-version.injectable";

/** Why GitLab could not be read for a watch, what to do about it, and what the CLI said on hover. */
export const GlabProblemNotice = ({ problem, hadData }: { problem: GlabProblem; hadData: boolean }) => {
  const openLink = useInject(openVersionInjectable)();

  return (
    <Div $flex={{ direction: "vertical", gap: "xs" }}>
      <Span $color={hadData ? "warning" : "critical"} $tooltip={problem.detail}>
        {problem.title}
      </Span>
      <Span $color="textMuted">
        {problem.fix}
        {problem.waitsForUser && " Checking is paused until then: use the refresh button to check again."}
        {hadData && " What was read before still shows."}
      </Span>
      {problem.cause === "unknown" && (
        <Span $color="textMuted" $font={{ size: "xs" }}>
          {problem.detail}
        </Span>
      )}
      {problem.link && (
        <A onClick={() => void openLink({ url: problem.link! })} $color="link">
          {problem.link}
        </A>
      )}
    </Div>
  );
};
