import { A, Div, Span } from "@k8slens/element-components";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { useEffect } from "react";
import { compareAheadInjectable } from "../pipelines/compare.injectable";
import { openVersionInjectable } from "../pipelines/open-version.injectable";

const shown = 12;

/** The commits and merge requests between two versions. */
export const AheadList = observer(
  ({
    host,
    project,
    from,
    to,
    branch,
    checkedAt,
  }: {
    host: string;
    project: string;
    from: string;
    to: string;
    branch?: string;
    checkedAt?: Date;
  }) => {
    const compare = useInject(compareAheadInjectable)(host, project, from, to, branch);
    const openPage = useInject(openVersionInjectable)();

    useEffect(() => {
      void compare.load();
    }, [compare, from, to, checkedAt]);

    const { state } = compare;
    const commits = state.status === "loaded" ? state.commits : [];
    const requests = state.status === "loaded" ? state.mergeRequests : [];

    return (
      <Div $flex={{ direction: "vertical", gap: "s" }} $padding={{ left: "xl" }}>
        {state.status === "loading" && <Span $color="textMuted">Reading the commits between the two…</Span>}
        {state.status === "failed" && (
          <Span $color="warning" $tooltip={state.problem.detail}>
            Could not compare the two versions: {state.problem.title}
          </Span>
        )}
        {state.status === "loaded" && commits.length === 0 && requests.length === 0 && (
          <Span $color="textMuted">GitLab lists nothing between these two.</Span>
        )}
        {requests.length > 0 && (
          <Div $flex={{ direction: "vertical", gap: "xs" }}>
            {requests.slice(0, shown).map((request) => (
              <A key={request.iid} onClick={() => request.url && void openPage({ url: request.url })} $color="link">
                !{request.iid} {request.title}
              </A>
            ))}
          </Div>
        )}
        {commits.length > 0 && (
          <Div $flex={{ direction: "vertical", gap: "xs" }}>
            {commits.slice(0, shown).map((commit) => (
              <Div key={commit.id} $flex={{ direction: "horizontal", gap: "s" }}>
                <A onClick={() => commit.url && void openPage({ url: commit.url })} $color="link">
                  {commit.label}
                </A>
                <Span $style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{commit.title}</Span>
              </Div>
            ))}
            {commits.length > shown && <Span $color="textMuted">and {commits.length - shown} more</Span>}
          </Div>
        )}
        {state.status === "loaded" && (
          <A onClick={() => void openPage({ url: state.url })} $color="link">
            Compare on GitLab
          </A>
        )}
      </Div>
    );
  },
);
