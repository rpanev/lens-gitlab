import { getInjectable2 } from "@k8slens/injectable";
import { watchOnClusterInjectable } from "../dashboard/watch-on-cluster.injectable";
import { watchNotifierInjectable } from "./watch-notifier.injectable";

/**
 * Follows a watch on a cluster the way the dashboard and the status bar do: keeping GitLab and the cluster
 * read, and telling of what changes. Both count as one follower each, so a cluster both follow is told of once.
 */
export const followWatchInjectable = getInjectable2({
  id: "lens-gitlab-follow-watch",

  instantiate: (di) => {
    const watchOnCluster = di.inject(watchOnClusterInjectable);
    const notifierOf = di.inject(watchNotifierInjectable);

    return () => (clusterId: string, watchKey: string) => {
      const stopWatching = watchOnCluster(clusterId, watchKey).watch();
      const stopTelling = notifierOf(clusterId, watchKey).follow();

      return () => {
        stopTelling();
        stopWatching();
      };
    };
  },
});
