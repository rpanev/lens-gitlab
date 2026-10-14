import { getInjectable2 } from "@k8slens/injectable";
import { activeTabClusterIdReactiveInjectionToken } from "@k8slens/main-view-contracts";
import { computed, observable, reaction, runInAction } from "mobx";
import { dashboardHealthInjectable } from "../dashboard/dashboard-health.injectable";
import { followWatchInjectable } from "../notifications/follow-watch.injectable";
import { watchKeyOf } from "../watched-repositories/watched-repository";
import { watchedRepositoriesStoreInjectable } from "../watched-repositories/watched-repositories-store.injectable";

/** How what is watched stands in the cluster of the selected tab, or the one selected last, for as long as something follows it. */
export const activeClusterHealthInjectable = getInjectable2({
  id: "lens-gitlab-active-cluster-health",
  consumptions: [activeTabClusterIdReactiveInjectionToken],

  instantiate: (di) => {
    const activeClusterId = di.inject(activeTabClusterIdReactiveInjectionToken)();
    const storeOf = di.inject(watchedRepositoriesStoreInjectable);
    const healthOf = di.inject(dashboardHealthInjectable);
    const followWatch = di.inject(followWatchInjectable)();

    // A tab of no cluster, such as the dashboard itself, leaves the cluster looked at last standing,
    // rather than the item disappearing exactly where it is wanted.
    const lastClusterId = observable.box<string | undefined>(undefined);

    reaction(
      () => activeClusterId.get(),
      (id) => id && runInAction(() => lastClusterId.set(id)),
      { fireImmediately: true },
    );

    /** The cluster looked at, or last looked at, when something is watched for it. */
    const clusterId = computed(() => {
      const id = activeClusterId.get() ?? lastClusterId.get();

      return id && (storeOf(id).all?.length ?? 0) > 0 ? id : undefined;
    });

    const watchKeys = computed(
      () => {
        const id = clusterId.get();

        return id ? (storeOf(id).all ?? []).map(watchKeyOf) : [];
      },
      { equals: (a, b) => a.length === b.length && a.every((key, index) => key === b[index]) },
    );

    const health = computed(() => {
      const id = clusterId.get();

      return id ? { clusterId: id, ...healthOf(id).get() } : undefined;
    });

    return () => ({
      get health() {
        return health.get();
      },

      /** Says which cluster a tab of no cluster of Lens's own, such as the dashboard, is about. */
      lookedAt: (id: string) => runInAction(() => lastClusterId.set(id)),

      /**
       * Keeps the selected cluster's watches running, switching to another cluster's as the user
       * switches tabs; the function it returns stops.
       */
      follow: () => {
        let stopWatches: (() => void)[] = [];

        const stop = reaction(
          () => [clusterId.get(), watchKeys.get()] as const,
          ([id, keys]) => {
            const previous = stopWatches;

            // The new ones start before the old ones stop, so what both share keeps running.
            stopWatches = id ? keys.map((key) => followWatch(id, key)) : [];
            previous.forEach((stopWatch) => stopWatch());
          },
          { fireImmediately: true },
        );

        return () => {
          stop();
          stopWatches.forEach((stopWatch) => stopWatch());
        };
      },
    });
  },
});
