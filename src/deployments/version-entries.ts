import type { DeployResource, Workload } from "./cluster-images";
import type { VersionSync } from "./gitops-syncs";
import type { VersionService } from "./version-services";

/** A service, a Kustomization or an Application at one version, with what its state means and where it is. */
export interface VersionEntry {
  readonly name: string;
  readonly state: VersionService["state"];
  readonly label: string;
  /** What its details are of: a service's first workload, or what deploys it when nothing runs it yet. */
  readonly resource?: Workload | DeployResource;
}

const serviceStateLabels: Record<VersionService["state"], string> = {
  running: "running",
  "rolling-out": "rolling out",
  "picked-up": "picked up by Flux",
  failed: "failed to apply",
};

const syncStateLabels: Record<VersionSync["state"], string> = {
  running: "applied",
  "rolling-out": "applying",
  "picked-up": "fetched, not applied yet",
  failed: "failed to apply",
};

export const entriesOfVersion = (
  services: readonly VersionService[] = [],
  syncs: readonly VersionSync[] = [],
): VersionEntry[] => [
  ...services.map(({ name, state, service }) => ({
    name,
    state,
    label: serviceStateLabels[state],
    resource: service.workloads[0] ?? service.deployer,
  })),
  ...syncs.map(({ name, state, sync }) => ({
    name,
    state,
    label: `${sync.resource.kind} ${syncStateLabels[state]}`,
    resource: sync.resource,
  })),
];
