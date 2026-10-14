import { getAskAiFunctionInjectableBunch, getAskAiFunctionKind } from "@k8slens/ask-ai-contracts";
import { openDashboardTabInjectable } from "../dashboard/open-dashboard-tab.injectable";

export const openDashboardFunctionKind = getAskAiFunctionKind<{ clusterId: string }>()("open-dashboard");

export default getAskAiFunctionInjectableBunch({
  kind: openDashboardFunctionKind,
  offeredIn: "every-conversation",
  description:
    "Opens the GitLabOps dashboard of a cluster in Lens: the banner, the watched projects, their pipelines and what the cluster runs of them. Use it when the user asks to see or open the GitLabOps view of the cluster. It does not change settings; opening GitLabOps settings is open-settings.",
  inputDescription: "`clusterId` (string): the Lens cluster id of the cluster the conversation is about.",
  outputDescription: "Nothing. Resolves once the dashboard tab is open.",
  invoke: {
    instantiate: (di) => {
      const openDashboard = di.inject(openDashboardTabInjectable)();

      return () =>
        async ({ clusterId }) => {
          await openDashboard(clusterId);
        };
    },
  },
});
