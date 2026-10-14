import { getAskAiFunctionInjectableBunch, getAskAiFunctionKind } from "@k8slens/ask-ai-contracts";
import type { WatchedRepository } from "../watched-repositories/watched-repository";
import { planSaveWatch, type SaveWatchRequest } from "../watched-repositories/watch-input";
import { watchedRepositoriesStoreInjectable } from "../watched-repositories/watched-repositories-store.injectable";
import { projectReadingOf } from "./reading";

export const saveWatchedProjectFunctionKind = getAskAiFunctionKind<
  SaveWatchRequest & { clusterId: string },
  { action: "added" | "updated" | "removed" } & ReturnType<typeof projectReadingOf>
>()("save-watched-project");

export default getAskAiFunctionInjectableBunch({
  kind: saveWatchedProjectFunctionKind,
  offeredIn: "own-conversations",
  description:
    'Watches a GitLab project on a cluster, changes one already watched, or stops watching it, for the GitLab extension. Use it when the user, in the GitLab dashboard\'s Ask AI terminal, asks to follow a project, change its branch, releases, check interval or notifications, or to stop watching it. A project is group/project, subgroups included, for example "watch group/app on main". The host defaults to gitlab.com. It does not open a screen and does not read pipelines; cluster-status and project-pipelines do that, from any conversation.',
  inputDescription:
    '`clusterId` (string): the Lens cluster id of the cluster the conversation is about. `project` (string): group/project, or a project URL. `host` (string, optional): the GitLab host; gitlab.com when omitted; ignored when project is a URL. `track` (string, optional): "branch" or "releases"; defaults to branch, or to what that project already follows when it has one watch. `branch` (string, optional): the branch when track is branch; defaults to main, or to the branch already watched. `includePrereleases` (boolean, optional): whether pre-releases count when track is releases; defaults to true. `tagPattern` (string, optional): which release tags count, such as "v*"; an empty string clears it. `intervalMinutes` (number, optional): 1, 5, 15, 30 or 60; defaults to 5, or to the interval already saved. `notify` (string, optional): "all", "failures" or "off"; defaults to "all", or to what is already saved. `stop` (boolean, optional): true stops watching that project instead of saving it.',
  outputDescription:
    '`action` ("added", "updated" or "removed"), then the project as saved: `host`, `project`, `follows`, `track`, `branch`, `includePrereleases`, `tagPattern`, `intervalMinutes`, `notify`.',
  invoke: {
    instantiate: (di) => {
      const storeOf = di.inject(watchedRepositoriesStoreInjectable);

      return () =>
        async ({ clusterId, ...request }) => {
          const store = storeOf(clusterId);
          const watched = store.all;

          if (!watched)
            throw new Error("The watched projects of this cluster are still being read. Try again in a moment.");

          const plan = planSaveWatch(watched, request);

          if (plan.action === "error") throw new Error(plan.message);

          await apply(store, plan);

          return { action: savedAction(plan.action), ...projectReadingOf(plan.watch) };
        };
    },
  },
});

const savedAction = (action: "add" | "replace" | "remove") => {
  switch (action) {
    case "add":
      return "added" as const;
    case "replace":
      return "updated" as const;
    case "remove":
      return "removed" as const;
  }
};

const apply = async (
  store: {
    add: (watch: WatchedRepository) => Promise<void>;
    replace: (previous: WatchedRepository, next: WatchedRepository) => Promise<void>;
    remove: (watch: WatchedRepository) => Promise<void>;
  },
  plan: Exclude<ReturnType<typeof planSaveWatch>, { action: "error" }>,
) => {
  if (plan.action === "add") await store.add(plan.watch);
  else if (plan.action === "replace") await store.replace(plan.previous, plan.watch);
  else await store.remove(plan.watch);
};
