import { A, Div, Span } from "@k8slens/element-components";
import { getInjectable2 } from "@k8slens/injectable";
import {
  showErrorNotificationInjectionToken,
  showSuccessNotificationInjectionToken,
} from "@k8slens/notifications-contracts";
import { computed, reaction } from "mobx";
import { clusterNameInjectable } from "../cluster/cluster-name.injectable";
import { openDashboardTabInjectable } from "../dashboard/open-dashboard-tab.injectable";
import { watchOnClusterInjectable } from "../dashboard/watch-on-cluster.injectable";
import { followedLabelOf, isSameWatch, watchOfKey } from "../watched-repositories/watched-repository";
import { watchedRepositoriesStoreInjectable } from "../watched-repositories/watched-repositories-store.injectable";
import { type Change, carryForward, changesBetween, isNotified, type Reading, readingOf } from "./reading";

const listed = (names: readonly string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const textOf = (change: Change, repository: string, followed: string, clusterName: string) => {
  switch (change.kind) {
    case "live":
      return `${listed(change.services)} ${change.services.length === 1 ? "runs" : "run"} ${change.label} on ${clusterName}`;
    case "ci-failed":
      return `CI failed on ${repository} ${followed} ${change.label}: ${listed(change.workflows)}`;
    case "failing":
      return `Failing to apply ${change.name} on ${clusterName}: ${change.message}`;
    case "unreadable":
      return `Could not read ${repository} on ${clusterName}: ${change.message}`;
  }
};

const Message = ({ text, onOpen }: { text: string; onOpen: () => void }) => (
  <Div $flex={{ direction: "vertical", gap: "xs" }}>
    <Span>{text}</Span>
    <A onClick={onOpen} $color="link">
      Open dashboard
    </A>
  </Div>
);

/**
 * Tells of what changes for one watch on one cluster, for as long as something follows it: services
 * going live, CI failing, something failing to apply, the cluster or GitLab becoming unreadable. Only
 * changes are told, so starting to follow tells nothing of what already was.
 */
export const watchNotifierInjectable = getInjectable2({
  id: "lens-gitlab-watch-notifier",
  consumptions: [showSuccessNotificationInjectionToken, showErrorNotificationInjectionToken],

  instantiate: (di) => {
    const watchOnCluster = di.inject(watchOnClusterInjectable);
    const storeOf = di.inject(watchedRepositoriesStoreInjectable);
    const clusterNameOf = di.inject(clusterNameInjectable);
    const openDashboard = di.inject(openDashboardTabInjectable)();
    const showSuccessNotification = di.inject(showSuccessNotificationInjectionToken)();
    const showErrorNotification = di.inject(showErrorNotificationInjectionToken)();

    return (clusterId: string, watchKey: string) => {
      const watchState = watchOnCluster(clusterId, watchKey);
      const watch = watchOfKey(watchKey);
      const clusterName = clusterNameOf(clusterId);
      let followers = 0;
      let stop: (() => void) | undefined;
      let previous: Reading | undefined;

      // Undefined while the first reading is still on its way.
      const reading = computed((): Reading | undefined => {
        const { activity, cluster, summary, rows } = watchState;

        if (activity.status === "failed")
          return readingOf({ services: [], syncs: [], unreadable: activity.problem.title });
        if (cluster.status === "failed") return readingOf({ services: [], syncs: [], unreadable: cluster.message });
        if (!summary) return undefined;

        return readingOf({ newest: rows[0], services: summary.services, syncs: summary.syncs });
      });

      const tell = (change: Change) => {
        const text = textOf(change, watch.repository, followedLabelOf(watch), clusterName.get() || clusterId);
        const message = <Message text={text} onOpen={() => void openDashboard(clusterId)} />;

        if (change.kind === "live") showSuccessNotification(message);
        else showErrorNotification(message);
      };

      return {
        /** Starts telling; the function it returns stops. */
        follow: () => {
          if (followers++ === 0)
            stop = reaction(
              () => reading.get(),
              (next) => {
                if (!next) return;

                const changes = changesBetween(previous, next);
                // The setting as it is now, so changing it takes effect without following again.
                const notify = storeOf(clusterId).all?.find((each) => isSameWatch(each, watch))?.notify;

                previous = carryForward(previous, next);
                changes.filter((change) => isNotified(change, notify)).forEach(tell);
              },
              { fireImmediately: true },
            );

          return () => {
            if (--followers > 0) return;

            stop?.();
            // Following again starts afresh, telling nothing of what happened meanwhile.
            previous = undefined;
          };
        },
      };
    };
  },
});
