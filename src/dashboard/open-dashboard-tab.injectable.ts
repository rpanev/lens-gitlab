import { getTabKind } from "@k8slens/tab-contracts";
import { getOpenClusterTabInjectable } from "../cluster/get-open-cluster-tab-injectable";

// One tab per cluster: its id is the cluster's id. Apart from the tab itself, so what opens it, such as a
// notification, does not depend on everything the tab renders.
export const dashboardTabKind = getTabKind()("lens-gitlab-dashboard");

export const openDashboardTabInjectable = getOpenClusterTabInjectable(
  "lens-gitlab-open-dashboard-tab",
  dashboardTabKind,
);
