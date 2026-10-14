import { connectClusterInjectionToken } from "@k8slens/cluster-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import {
  appsV1,
  coreV1,
  daemonSetKind,
  deploymentKind,
  kubeResourcesInjectionToken,
  podKind,
  statefulSetKind,
} from "@k8slens/kubernetes-contracts";
import type { Subscribable } from "@k8slens/subscribable";
import { comparer, computed, type IComputedValue, observable, runInAction } from "mobx";
import {
  type ClusterImages,
  type DeployResource,
  fluxOwnerOf,
  type GitSource,
  type HelmChart,
  fluxStateOf,
  withFailingDependencies,
  type ImageAutomation,
  type ImageSelection,
  type Workload,
} from "./cluster-images";
import { applicationKind, applicationResourceOf, argoOwnerOf, argoprojV1alpha1 } from "./argo-kinds";
import {
  commitOfRevision,
  gitRepositoryKind,
  gitProjectOfUrl,
  helmChartKind,
  helmReleaseKind,
  helmToolkitV2,
  helmToolkitV2beta2,
  imagePolicyKind,
  imageToolkitV1,
  imageToolkitV1beta2,
  imageUpdateAutomationKind,
  kustomizationKind,
  kustomizeToolkitV1,
  selectedImageOf,
  sourceToolkitV1,
  sourceToolkitV1beta2,
} from "./flux-kinds";
import {
  daemonSetStatusOf,
  deploymentStatusOf,
  type PodReadiness,
  podReadinessOf,
  statefulSetStatusOf,
  withSettledAtOfPods,
  type WorkloadStatus,
} from "./workload-status";

export type ClusterImagesState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly images: ClusterImages }
  | { readonly status: "failed"; readonly message: string };

type Source<T> = IComputedValue<readonly T[]>;

interface Template {
  metadata?: { labels?: Record<string, string> };
  spec?: { containers?: { image?: string }[]; initContainers?: { image?: string }[] };
}

const imagesOf = (template?: Template) =>
  [...(template?.spec?.containers ?? []), ...(template?.spec?.initContainers ?? [])].flatMap((container) =>
    container.image ? [container.image] : [],
  );

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const none = <T>() => computed((): readonly T[] => []);

/** How long after failing to read the cluster it is tried again, while something still watches. */
export const clusterRetrySeconds = 30;

/** What a cluster runs and how Flux is getting it there, kept current for as long as something watches it. */
export const clusterImagesInjectable = getInjectable2({
  id: "lens-gitlab-cluster-images",
  consumptions: [connectClusterInjectionToken, kubeResourcesInjectionToken],

  instantiate: (di) => {
    const connectCluster = di.inject(connectClusterInjectionToken);
    const kubeResources = di.inject(kubeResourcesInjectionToken)();

    return (clusterId: string) => {
      const sources = observable.box<
        | {
            workloads: Source<Workload>[];
            pods: Source<PodReadiness>;
            imageSelections: Source<ImageSelection>;
            deployResources: Source<DeployResource>[];
            imageAutomations: Source<ImageAutomation>;
            helmCharts: Source<HelmChart>;
            gitSources: Source<GitSource>;
          }
        | undefined
      >(undefined, { deep: false });
      const failure = observable.box<string | undefined>(undefined);
      let disposers: (() => void)[] = [];
      let watchers = 0;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      // Tells a start still connecting apart from the watch it was started for, once that has stopped.
      let generation = 0;

      /**
       * Follows resources for the attempt started at `startedFor`: a subscription arriving after that
       * attempt failed or was stopped, as a fallback version tried late does, lets go of itself.
       */
      const followFor =
        (startedFor: number) =>
        async <T, R>(subscribable: Subscribable<readonly T[]>, toItems: (resource: T) => R[]): Promise<Source<R>> => {
          const subscription = subscribable.subscribe();

          subscription.claim();
          if (startedFor === generation) disposers.push(subscription.dispose);
          else subscription.dispose();

          const resources = await subscription.value;

          return computed(() => resources.get().flatMap(toItems));
        };

      /** Follows the first version the cluster serves; none when Flux's part is not installed. */
      const followOptional = <R>(...attempts: (() => Promise<Source<R>>)[]) =>
        attempts
          .reduce((previous, attempt) => previous.catch(attempt), Promise.reject<Source<R>>(new Error("not served")))
          .catch(() => none<R>());

      // Flux labels what it applies; Argo CD tracks it by an annotation, or by a label in its older default.
      const ownerOfWorkload = (
        metadata: { labels?: Record<string, string>; annotations?: Record<string, string> },
        templateLabels?: Record<string, string>,
      ) => {
        const labels = { ...templateLabels, ...metadata.labels };

        return fluxOwnerOf(labels) ?? argoOwnerOf(labels, metadata.annotations);
      };

      const workloadOf =
        (kind: Workload["kind"], statusOf: (resource: any) => WorkloadStatus) =>
        (resource: {
          metadata: {
            namespace: string;
            name: string;
            labels?: Record<string, string>;
            annotations?: Record<string, string>;
          };
          spec: { template?: Template };
        }): Workload[] => {
          const { rolledOut, ready, desired, settledAt } = statusOf(resource);

          return [
            {
              kind,
              namespace: resource.metadata.namespace,
              name: resource.metadata.name,
              images: imagesOf(resource.spec.template),
              rolledOut,
              replicas: { ready, desired },
              settledAt,
              owner: ownerOfWorkload(resource.metadata, resource.spec.template?.metadata?.labels),
            },
          ];
        };

      const fluxResourceOf =
        (kind: DeployResource["kind"], apiVersion: DeployResource["apiVersion"]) =>
        (resource: {
          metadata: { namespace: string; name: string };
          spec?: {
            sourceRef?: { kind: string; name: string; namespace?: string };
            dependsOn?: readonly { name: string; namespace?: string }[];
          };
          status?: {
            conditions?: readonly any[];
            lastAppliedRevision?: string;
            lastAttemptedRevision?: string;
            helmChart?: string;
            history?: readonly { chartVersion?: string; status?: string }[];
          };
        }): DeployResource[] => {
          const status = resource.status ?? {};

          return [
            {
              kind,
              apiVersion,
              namespace: resource.metadata.namespace,
              name: resource.metadata.name,
              ...fluxStateOf(status.conditions),
              // What it depends on is of its own kind, in its own namespace unless it says another.
              dependsOn: resource.spec?.dependsOn?.map((dependency) => ({
                kind,
                name: dependency.name,
                namespace: dependency.namespace ?? resource.metadata.namespace,
              })),
              revision: status.lastAppliedRevision ?? status.lastAttemptedRevision,
              sourceRef:
                kind === "Kustomization" && resource.spec?.sourceRef
                  ? {
                      kind: resource.spec.sourceRef.kind,
                      name: resource.spec.sourceRef.name,
                      namespace: resource.spec.sourceRef.namespace ?? resource.metadata.namespace,
                    }
                  : undefined,
              appliedCommit: kind === "Kustomization" ? commitOfRevision(status.lastAppliedRevision) : undefined,
              attemptedCommit: kind === "Kustomization" ? commitOfRevision(status.lastAttemptedRevision) : undefined,
              chart:
                kind === "HelmRelease"
                  ? {
                      helmChart: status.helmChart,
                      // Flux 2.3 and later keep a history of what was released; before, the applied revision is the chart version.
                      applied:
                        status.history?.find((release) => release.status === "deployed")?.chartVersion ??
                        status.lastAppliedRevision,
                      attempted: status.lastAttemptedRevision,
                    }
                  : undefined,
            },
          ];
        };

      const gitSourceOf = (repository: {
        metadata: { namespace: string; name: string };
        spec: { url: string; ref?: { branch?: string } };
        status?: { artifact?: { revision?: string } };
      }): GitSource[] => {
        const project = gitProjectOfUrl(repository.spec.url);

        return [
          {
            namespace: repository.metadata.namespace,
            name: repository.metadata.name,
            repository: project?.project,
            host: project?.host,
            branch: repository.spec.ref?.branch,
            commit: commitOfRevision(repository.status?.artifact?.revision),
          },
        ];
      };

      const helmChartOf = (chart: {
        metadata: { namespace: string; name: string };
        status?: { artifact?: { revision?: string }; observedSourceArtifactRevision?: string };
      }): HelmChart[] => [
        {
          namespace: chart.metadata.namespace,
          name: chart.metadata.name,
          version: chart.status?.artifact?.revision,
          sourceCommit: commitOfRevision(chart.status?.observedSourceArtifactRevision),
        },
      ];

      const imageSelectionOf = (policy: {
        metadata: { namespace: string; name: string };
        status?: Parameters<typeof selectedImageOf>[0];
      }): ImageSelection[] => {
        const image = selectedImageOf(policy.status);

        return image ? [{ namespace: policy.metadata.namespace, name: policy.metadata.name, image }] : [];
      };

      const imageAutomationOf = (automation: {
        metadata: { namespace: string; name: string };
        status?: { lastPushTime?: string; lastPushCommit?: string };
      }): ImageAutomation[] => [
        {
          namespace: automation.metadata.namespace,
          name: automation.metadata.name,
          lastPushTime: automation.status?.lastPushTime,
          lastPushCommit: automation.status?.lastPushCommit,
        },
      ];

      const start = async () => {
        const startedFor = generation;
        const follow = followFor(startedFor);

        try {
          await connectCluster(clusterId);

          if (startedFor !== generation) return;

          const [
            deployments,
            statefulSets,
            daemonSets,
            pods,
            imageSelections,
            kustomizations,
            helmReleases,
            imageAutomations,
            helmCharts,
            gitSources,
            applications,
          ] = await Promise.all([
            follow(kubeResources(deploymentKind, appsV1, clusterId), workloadOf("Deployment", deploymentStatusOf)),
            follow(kubeResources(statefulSetKind, appsV1, clusterId), workloadOf("StatefulSet", statefulSetStatusOf)),
            follow(kubeResources(daemonSetKind, appsV1, clusterId), workloadOf("DaemonSet", daemonSetStatusOf)),
            follow(kubeResources(podKind, coreV1, clusterId), podReadinessOf),
            // Flux and each of its parts are optional, and served in versions that depend on Flux's.
            followOptional(
              () => follow(kubeResources(imagePolicyKind, imageToolkitV1, clusterId), imageSelectionOf),
              () => follow(kubeResources(imagePolicyKind, imageToolkitV1beta2, clusterId), imageSelectionOf),
            ),
            followOptional(() =>
              follow(
                kubeResources(kustomizationKind, kustomizeToolkitV1, clusterId),
                fluxResourceOf("Kustomization", kustomizeToolkitV1),
              ),
            ),
            followOptional(
              () =>
                follow(
                  kubeResources(helmReleaseKind, helmToolkitV2, clusterId),
                  fluxResourceOf("HelmRelease", helmToolkitV2),
                ),
              () =>
                follow(
                  kubeResources(helmReleaseKind, helmToolkitV2beta2, clusterId),
                  fluxResourceOf("HelmRelease", helmToolkitV2beta2),
                ),
            ),
            followOptional(
              () => follow(kubeResources(imageUpdateAutomationKind, imageToolkitV1, clusterId), imageAutomationOf),
              () => follow(kubeResources(imageUpdateAutomationKind, imageToolkitV1beta2, clusterId), imageAutomationOf),
            ),
            followOptional(
              () => follow(kubeResources(helmChartKind, sourceToolkitV1, clusterId), helmChartOf),
              () => follow(kubeResources(helmChartKind, sourceToolkitV1beta2, clusterId), helmChartOf),
            ),
            followOptional(
              () => follow(kubeResources(gitRepositoryKind, sourceToolkitV1, clusterId), gitSourceOf),
              () => follow(kubeResources(gitRepositoryKind, sourceToolkitV1beta2, clusterId), gitSourceOf),
            ),
            // Argo CD is optional like Flux.
            followOptional(() =>
              follow(kubeResources(applicationKind, argoprojV1alpha1, clusterId), (application) => [
                applicationResourceOf(application),
              ]),
            ),
          ]);

          if (startedFor !== generation) return;

          runInAction(() => {
            failure.set(undefined);
            sources.set({
              workloads: [deployments, statefulSets, daemonSets],
              // Pods change all the time, mostly in what counts for nothing here: only a pod of a StatefulSet
              // or a DaemonSet becoming Ready, or ceasing to be, reads the cluster anew.
              pods: computed(() => pods.get(), { equals: comparer.structural }),
              imageSelections,
              deployResources: [kustomizations, helmReleases, applications],
              imageAutomations,
              helmCharts,
              gitSources,
            });
          });
        } catch (error) {
          if (startedFor !== generation) return;

          // What was subscribed before the failure is let go, and all of it asked for again in a while:
          // a connection that dropped, or a cluster that was unreachable, comes back without a reopen.
          // Moving on a generation makes what this attempt still has in flight let go of itself too.
          generation++;
          disposers.forEach((dispose) => dispose());
          disposers = [];
          runInAction(() => failure.set(messageOf(error)));
          // Stopping clears the timer, so a retry only ever starts for a watch still running.
          retryTimer = setTimeout(() => void start(), clusterRetrySeconds * 1000);
        }
      };

      const state = computed((): ClusterImagesState => {
        const message = failure.get();
        const loaded = sources.get();

        if (message) return { status: "failed", message };
        if (!loaded) return { status: "loading" };

        return {
          status: "loaded",
          images: {
            workloads: withSettledAtOfPods(
              loaded.workloads.flatMap((source) => source.get()),
              loaded.pods.get(),
            ),
            imageSelections: loaded.imageSelections.get(),
            deployResources: withFailingDependencies(loaded.deployResources.flatMap((source) => source.get())),
            imageAutomations: loaded.imageAutomations.get(),
            helmCharts: loaded.helmCharts.get(),
            gitSources: loaded.gitSources.get(),
          },
        };
      });

      return {
        get state() {
          return state.get();
        },

        /** Starts following the cluster; the function it returns stops. */
        watch: () => {
          if (watchers++ === 0) void start();

          return () => {
            if (--watchers > 0) return;

            generation++;
            clearTimeout(retryTimer);
            runInAction(() => failure.set(undefined));
            disposers.forEach((dispose) => dispose());
            disposers = [];
            runInAction(() => sources.set(undefined));
          };
        },
      };
    };
  },
});
