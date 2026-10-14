import { getInjectable2 } from "@k8slens/injectable";
import { computed } from "mobx";
import { imageIsOfCommit, imageIsOfRelease } from "../deployments/cluster-images";
import { clusterImagesInjectable } from "../deployments/cluster-images.injectable";
import { type ImageMatches, type Service, servicesOf, versionsRunningOf } from "../deployments/services";
import { type GitOpsSync, gitOpsSyncsOf, syncsOfVersion, type VersionSync } from "../deployments/gitops-syncs";
import { servicesOfVersion, type VersionService } from "../deployments/version-services";
import { hostOf, isReleasesWatch, watchOfKey } from "../watched-repositories/watched-repository";
import { trackActivityInjectable } from "../workflow-runs/track-activity.injectable";
import type { VersionRuns } from "../workflow-runs/version";

export interface VersionRow extends VersionRuns {
  /** Undefined while the cluster is still being read, or when it could not be. */
  readonly services?: readonly VersionService[];
  readonly syncs?: readonly VersionSync[];
}

export interface ServicesSummary {
  readonly services: readonly Service[];
  /** The Kustomizations and Argo CD Applications applying the watched branch, for a branch the cluster syncs from. */
  readonly syncs: readonly GitOpsSync[];
  readonly versionsRunning: number;
  readonly onNewest: number;
}

const byCommit: ImageMatches = (image, version) => imageIsOfCommit(image, version.id);
const byReleaseTag: ImageMatches = (image, version) => imageIsOfRelease(image, version.id);

/** A watch's latest versions and runs, with what one cluster runs of them. */
export const watchOnClusterInjectable = getInjectable2({
  id: "lens-gitlab-watch-on-cluster",

  instantiate: (di) => {
    const trackActivityOf = di.inject(trackActivityInjectable);
    const clusterImagesOf = di.inject(clusterImagesInjectable);

    return (clusterId: string, watchKey: string) => {
      const activity = trackActivityOf(watchKey);
      const clusterImages = clusterImagesOf(clusterId);
      const watch = watchOfKey(watchKey);
      const matches = isReleasesWatch(watch) ? byReleaseTag : byCommit;

      const summary = computed((): ServicesSummary | undefined => {
        const trackState = activity.state;
        const clusterState = clusterImages.state;

        if (trackState.status !== "loaded" || clusterState.status !== "loaded") return undefined;

        const services = servicesOf(trackState.versions, matches, clusterState.images);
        const syncs = isReleasesWatch(watch)
          ? []
          : gitOpsSyncsOf(watch.repository, watch.branch, trackState.versions, clusterState.images, hostOf(watch));

        return {
          services,
          syncs,
          versionsRunning: versionsRunningOf(services),
          onNewest: services.filter((service) => service.running?.behind === 0).length,
        };
      });

      const rows = computed((): readonly VersionRow[] => {
        const trackState = activity.state;
        const loaded = summary.get();

        if (trackState.status !== "loaded") return [];

        return trackState.recent.map((recent) => ({
          ...recent,
          services: loaded && servicesOfVersion(recent.version.id, loaded.services),
          syncs: loaded && syncsOfVersion(recent.version.id, loaded.syncs),
        }));
      });

      return {
        get activity() {
          return activity.state;
        },

        get cluster() {
          return clusterImages.state;
        },

        get summary() {
          return summary.get();
        },

        get rows() {
          return rows.get();
        },

        refresh: activity.refresh,

        /** Starts following both; the function it returns stops. */
        watch: () => {
          // A deployment under way keeps the checks live, so what follows it shows up soon.
          const stopActivity = activity.watch(
            () =>
              (summary.get()?.services ?? []).some(
                (service) => service.rollingOut || service.pickedUp || service.chart?.pending?.stage === "upgrading",
              ) || (summary.get()?.syncs ?? []).some((sync) => sync.pending && sync.pending.stage !== "failed"),
          );
          const stopCluster = clusterImages.watch();

          return () => {
            stopActivity();
            stopCluster();
          };
        },
      };
    };
  },
});
