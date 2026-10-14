import { AskAiTerminal } from "@k8slens/ask-ai-contracts";
import { Button, Div, Span } from "@k8slens/element-components";
import { KeyboardArrowDownIcon, KeyboardArrowUpIcon, TerminalIcon } from "@k8slens/icon";
import { useInject } from "@k8slens/use-inject";
import { useState } from "react";
import { ownScopeIdsInjectable } from "../ask-ai/own-scope-ids.injectable";

const context = [
  "The user is on the GitLabOps dashboard of this cluster, in the lens-gitlab extension.",
  "The banner says how the cluster stands: Up to date, Behind, Deploying, Failing, Unreachable, Checking or Not deployed.",
  "Watched projects are GitLab projects, written group/project with subgroups included. The host defaults to gitlab.com.",
  "Each watch follows a branch's commits or the project's releases. The cluster is compared by image tag, Flux image automation, Helm releases, Flux Kustomizations and Argo CD Applications.",
  'From this terminal the user can say "watch group/app on main", change a watch, or stop watching a project, instead of using the form.',
].join("\n");

/** The dashboard's own Ask AI terminal, folded until opened: watching a project can be said instead of filled in. */
export const DashboardAssistant = ({ clusterId }: { clusterId: string }) => {
  const ownScopeIds = useInject(ownScopeIdsInjectable)();
  const [open, setOpen] = useState(false);

  return (
    <Div
      $flex={{ direction: "vertical" }}
      $border={{ top: { width: "xxs", color: "grey60" } }}
      $style={{ flexShrink: 0, height: open ? "16rem" : undefined }}
    >
      <Button
        $onClick={() => setOpen((folded) => !folded)}
        $tooltip={open ? "Hide Ask AI" : "Show Ask AI"}
        $interactive
        $width="full"
        $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}
        $padding={{ horizontal: "l", vertical: "s" }}
      >
        <TerminalIcon $size="s" />
        <Span $flexChild>Ask AI</Span>
        {open ? <KeyboardArrowDownIcon $size="s" /> : <KeyboardArrowUpIcon $size="s" />}
      </Button>
      {open && (
        <Div $flexChild $style={{ minHeight: 0 }}>
          <AskAiTerminal
            sessionId={`lens-gitlab-dashboard-${clusterId}`}
            clusterId={clusterId}
            scopeIds={ownScopeIds}
            context={context}
          />
        </Div>
      )}
    </Div>
  );
};
