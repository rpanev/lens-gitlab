import type { DeployResource, Workload } from "./cluster-images";
import type { VersionSync } from "./gitops-syncs";
import { entriesOfVersion } from "./version-entries";
import type { VersionService } from "./version-services";

/**
 * One row of what the cluster runs of a version, as Lens lists workloads: a workload of a service, or a
 * Kustomization or an Application applying the version.
 */
export interface VersionResource {
  readonly id: string;
  readonly name: string;
  readonly namespace: string;
  /** What its details are of. */
  readonly resource: Workload | DeployResource;
  readonly state: VersionService["state"];
  /** What its state means: "running", "rolling out", "Kustomization applied"… */
  readonly label: string;
  /** For a workload: its replicas that are ready, of those it wants. */
  readonly pods?: { readonly ready: number; readonly desired: number };
  /** For a Deployment: when it last settled with every replica updated and available. */
  readonly settledAt?: string;
  /** For a workload: what applies it, and the chart version installed, for a HelmRelease. */
  readonly deployer?: DeployResource;
  readonly chart?: string;
}

const idOf = (resource: Workload | DeployResource) => `${resource.kind}/${resource.namespace}/${resource.name}`;

export const resourcesOfVersion = (
  services: readonly VersionService[] = [],
  syncs: readonly VersionSync[] = [],
): VersionResource[] => {
  const [serviceEntries, syncEntries] = [entriesOfVersion(services), entriesOfVersion([], syncs)];

  const ofServices = services.flatMap(({ service }, index): VersionResource[] => {
    const { state, label } = serviceEntries[index];
    // A service Flux has selected a build for, but nothing runs yet, is what deploys it: deployed by nothing more.
    if (service.workloads.length === 0) {
      return service.deployer
        ? [
            {
              state,
              label,
              id: idOf(service.deployer),
              name: service.name,
              namespace: service.deployer.namespace,
              resource: service.deployer,
            },
          ]
        : [];
    }

    return service.workloads.map((workload) => ({
      state,
      label,
      deployer: service.deployer,
      chart: service.chart?.applied,
      id: idOf(workload),
      name: workload.name,
      namespace: workload.namespace,
      resource: workload,
      pods: workload.replicas,
      settledAt: workload.settledAt,
    }));
  });

  const ofSyncs = syncs.map(({ sync }, index): VersionResource => ({
    id: idOf(sync.resource),
    name: sync.resource.name,
    namespace: sync.resource.namespace,
    resource: sync.resource,
    state: syncEntries[index].state,
    label: syncEntries[index].label,
  }));

  // A service whose build and chart are both of the version is listed twice: its first row per resource is kept.
  return [...ofServices, ...ofSyncs].filter(
    (row, index, rows) => rows.findIndex((each) => each.id === row.id) === index,
  );
};
