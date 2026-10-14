import { getAskAiFunctionInjectableBunch, getAskAiFunctionKind } from "@k8slens/ask-ai-contracts";
import { dashboardHealthInjectable } from "../dashboard/dashboard-health.injectable";
import { watchedRepositoriesStoreInjectable } from "../watched-repositories/watched-repositories-store.injectable";
import { clusterStatusReadingOf } from "./reading";

export const clusterStatusFunctionKind = getAskAiFunctionKind<
  { clusterId: string },
  ReturnType<typeof clusterStatusReadingOf>
>()("cluster-status");

export default getAskAiFunctionInjectableBunch({
  kind: clusterStatusFunctionKind,
  offeredIn: "every-conversation",
  description:
    "Reports how one cluster stands in the GitLab extension, and which GitLab projects that cluster watches. Use it to answer whether the cluster is up to date, behind, deploying, failing, unreachable or not configured, and to list the watched projects. For the pipelines of one named project, use project-pipelines instead. It does not change what is watched and does not open a screen.",
  inputDescription: "`clusterId` (string): the Lens cluster id of the cluster the conversation is about.",
  outputDescription:
    '`ready` (boolean): false while the watched list is still being read. `state` (string or null): "not-configured", "checking", "unreachable", "failing", "deploying", "behind", "up-to-date" or "nothing-deployed", or null when not ready. `label` (string): the banner words, such as "Up to date". `message` (string): the banner\'s reason. `projects` (array): each has `host` (string), `project` (string, group/project), `follows` (string, such as "main" or "releases"), `track` ("branch" or "releases"), `branch` (string), `includePrereleases` (boolean or null), `tagPattern` (string or null), `intervalMinutes` (number), `notify` ("all", "failures" or "off").',
  invoke: {
    instantiate: (di) => {
      const storeOf = di.inject(watchedRepositoriesStoreInjectable);
      const healthOf = di.inject(dashboardHealthInjectable);

      return () =>
        async ({ clusterId }) =>
          clusterStatusReadingOf(storeOf(clusterId).all, healthOf(clusterId).get());
    },
  },
});
