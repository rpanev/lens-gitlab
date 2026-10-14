import { Button, Span } from "@k8slens/element-components";
import { CheckCircleIcon, ErrorIcon, ScheduleIcon, WarningIcon } from "@k8slens/icon";
import { GitlabIcon } from "../gitlab-icon";
import { getInjectable2 } from "@k8slens/injectable";
import { statusBarItemInjectionToken } from "@k8slens/status-bar-contracts";
import { useInject } from "@k8slens/use-inject";
import { computed } from "mobx";
import { observer } from "mobx-react";
import { useEffect } from "react";
import { openDashboardTabInjectable } from "../dashboard/open-dashboard-tab.injectable";
import type { DashboardHealth } from "../dashboard/dashboard-health.injectable";
import { activeClusterHealthInjectable } from "./active-cluster-health.injectable";

const labels: Record<DashboardHealth["state"], string> = {
  checking: "GitLabOps",
  unreachable: "Unreachable",
  failing: "Failing",
  deploying: "Deploying",
  behind: "Behind",
  "up-to-date": "Up to date",
  "nothing-deployed": "GitLabOps",
};

const StateIcon = ({ state }: { state: DashboardHealth["state"] }) => {
  switch (state) {
    case "up-to-date":
      return <CheckCircleIcon $size="xs" $color="success" />;
    case "failing":
      return <ErrorIcon $size="xs" $color="critical" />;
    case "deploying":
      return <ScheduleIcon $size="xs" $color="primary" />;
    case "behind":
    case "unreachable":
      return <WarningIcon $size="xs" $color="notice" />;
    default:
      return null;
  }
};

const GithubActionsStatus = observer(() => {
  const activeClusterHealth = useInject(activeClusterHealthInjectable)();
  const openDashboard = useInject(openDashboardTabInjectable)();
  const { health } = activeClusterHealth;

  // Keeps the selected cluster followed while the item is in the status bar.
  useEffect(() => activeClusterHealth.follow(), [activeClusterHealth]);

  if (!health) return null;

  return (
    <Button
      $flex={{ direction: "horizontal", gap: "xs", verticalAlign: "center" }}
      $onClick={() => void openDashboard(health.clusterId)}
      $tooltip={`GitLabOps: ${health.message}`}
      $interactive
    >
      <GitlabIcon $size="s" />
      {/* The size the status bar's own items, such as Support, are set in. */}
      <Span $font={{ size: "xs" }}>{labels[health.state]}</Span>
      <StateIcon state={health.state} />
    </Button>
  );
});

export const statusBarItemInjectable = getInjectable2({
  id: "lens-gitlab-status-bar-item",

  instantiate: (di) => {
    const activeClusterHealth = di.inject(activeClusterHealthInjectable)();

    return () => ({
      Component: GithubActionsStatus,
      position: "right" as const,
      orderNumber: 90,
      // Only for a cluster something is watched for.
      isVisible: computed(() => activeClusterHealth.health !== undefined),
    });
  },
  injectionToken: statusBarItemInjectionToken,
});
