import type { Version } from "../workflow-runs/version";
import {
  type ClusterImages,
  type DeployResource,
  type HelmChart,
  type ImageAutomation,
  type ImageSelection,
  imageNameOf,
  isSameOwner,
  type Workload,
} from "./cluster-images";

/** Whether an image was built from a version: the matching differs between commits and releases. */
export type ImageMatches = (image: string, version: Version) => boolean;

/** Where a version stands: its index among the latest versions, 0 being the newest. */
export interface VersionOnTrack {
  readonly id: string;
  readonly label: string;
  readonly at: string;
  readonly behind: number;
  /** Its page on GitHub. */
  readonly url: string;
}

/**
 * How far Flux has got with a newer build than the one running: its image selected by an
 * ImagePolicy, the tag committed to the GitOps repository by an ImageUpdateAutomation, that commit
 * being applied by the Kustomization or HelmRelease, or applying it having failed.
 */
export type FluxStage = "selected" | "committed" | "applying" | "failed";

/** The chart a service's HelmRelease installs, and a newer one on its way. */
export interface ServiceChart {
  /** The chart version installed. */
  readonly applied?: string;
  /** A chart version newer than the installed one: built by Flux and not installed yet, being installed, or failed to install. */
  readonly pending?: { readonly version: string; readonly stage: "waiting" | "upgrading" | "failed" };
  /** The commit the chart Flux has now was built from, for a chart kept in a Git repository. */
  readonly sourceCommit?: string;
  /** Where that commit stands among the versions watched, when it is one of them. */
  readonly source?: VersionOnTrack;
}

/** A service of the repository, as the cluster runs it. Named after its image. */
export interface Service {
  readonly name: string;
  /** The oldest version its workloads run; undefined when Flux has selected it but nothing runs it yet. */
  readonly running?: VersionOnTrack;
  readonly rollingOut: boolean;
  readonly workloads: readonly Workload[];
  /** The Kustomization, HelmRelease or Argo CD Application that applies its workloads. */
  readonly deployer?: DeployResource;
  /** For a service a HelmRelease applies. */
  readonly chart?: ServiceChart;
  /** A version newer than the running one that Flux image automation has selected, and how far Flux has got with it. */
  readonly pickedUp?: VersionOnTrack & {
    readonly stage: FluxStage;
    readonly imageSelections: readonly ImageSelection[];
    readonly imageAutomations: readonly ImageAutomation[];
  };
}

const versionOnTrackOf = (
  image: string,
  versions: readonly Version[],
  matches: ImageMatches,
): VersionOnTrack | undefined => {
  const behind = versions.findIndex((version) => matches(image, version));

  if (behind === -1) return undefined;

  const { id, label, at, url } = versions[behind];

  return { id, label, at, url, behind };
};

const deployerOf = (workloads: readonly Workload[], deployResources: readonly DeployResource[]) =>
  workloads
    .flatMap((workload) => (workload.owner ? [workload.owner] : []))
    .map((owner) => deployResources.find((resource) => isSameOwner(resource, owner)))
    .find((resource) => resource !== undefined);

/**
 * Flux does not say which of its GitOps commits carries which tag, so a selected build counts as
 * committed once an ImageUpdateAutomation next to its ImagePolicy has pushed after the version was made.
 */
const pushesAfter = (
  selected: VersionOnTrack,
  imageSelections: readonly ImageSelection[],
  imageAutomations: readonly ImageAutomation[],
) => {
  const namespaces = new Set(imageSelections.map((selection) => selection.namespace));
  const nearby = imageAutomations.filter((automation) => namespaces.has(automation.namespace));

  return (nearby.length > 0 ? nearby : imageAutomations).filter(
    (automation) => automation.lastPushTime && new Date(automation.lastPushTime) >= new Date(selected.at),
  );
};

const stageOf = (pushes: readonly ImageAutomation[], flux?: DeployResource): FluxStage => {
  if (flux?.state === "failed") return "failed";
  if (pushes.length === 0) return "selected";

  return flux?.state === "reconciling" ? "applying" : "committed";
};

const chartOf = (
  deployer: DeployResource | undefined,
  helmCharts: readonly HelmChart[],
  versions: readonly Version[],
): ServiceChart | undefined => {
  if (!deployer?.chart) return undefined;

  const { helmChart: helmChartRef, applied, attempted } = deployer.chart;
  const helmChart = helmCharts.find((chart) => `${chart.namespace}/${chart.name}` === helmChartRef);
  // What Flux has built and not installed yet, or what it tried to install and could not.
  const newer = [helmChart?.version, attempted].find((version) => version && version !== applied);
  const behind = versions.findIndex((version) => version.id === helmChart?.sourceCommit);

  return {
    applied,
    pending: newer
      ? {
          version: newer,
          stage: deployer.state === "failed" ? "failed" : deployer.state === "reconciling" ? "upgrading" : "waiting",
        }
      : undefined,
    sourceCommit: helmChart?.sourceCommit,
    source:
      behind === -1
        ? undefined
        : {
            id: versions[behind].id,
            label: versions[behind].label,
            at: versions[behind].at,
            url: versions[behind].url,
            behind,
          },
  };
};

/** The services the cluster runs from images built from any of the latest versions, newest first. */
export const servicesOf = (
  versions: readonly Version[],
  matches: ImageMatches,
  { workloads, imageSelections, deployResources, imageAutomations, helmCharts }: ClusterImages,
) => {
  const services = new Map<
    string,
    { running?: VersionOnTrack; workloads: Workload[]; selected?: VersionOnTrack; imageSelections: ImageSelection[] }
  >();
  const serviceNamed = (name: string) =>
    services.get(name) ?? services.set(name, { workloads: [], imageSelections: [] }).get(name)!;

  for (const workload of workloads) {
    for (const image of workload.images) {
      const onBranch = versionOnTrackOf(image, versions, matches);

      if (!onBranch) continue;

      const service = serviceNamed(imageNameOf(image));

      if (!service.workloads.includes(workload)) service.workloads.push(workload);
      if (!service.running || onBranch.behind > service.running.behind) service.running = onBranch;
    }
  }

  for (const selection of imageSelections) {
    const onBranch = versionOnTrackOf(selection.image, versions, matches);

    if (!onBranch) continue;

    const service = serviceNamed(imageNameOf(selection.image));

    service.imageSelections.push(selection);
    if (!service.selected || onBranch.behind < service.selected.behind) service.selected = onBranch;
  }

  return [...services]
    .map(([name, { running, workloads, selected, imageSelections }]): Service => {
      const deployer = deployerOf(workloads, deployResources);
      const newer = selected && (!running || selected.behind < running.behind) ? selected : undefined;
      const newerVersion = newer && versions[newer.behind];
      const selecting = newerVersion ? imageSelections.filter((each) => matches(each.image, newerVersion)) : [];
      const pushes = newer ? pushesAfter(newer, selecting, imageAutomations) : [];

      return {
        name,
        running,
        rollingOut: workloads.some((workload) => !workload.rolledOut),
        workloads,
        deployer,
        chart: chartOf(deployer, helmCharts, versions),
        pickedUp: newer && {
          ...newer,
          stage: stageOf(pushes, deployer),
          imageSelections: selecting,
          imageAutomations: pushes,
        },
      };
    })
    .sort((a, b) => (a.running?.behind ?? -1) - (b.running?.behind ?? -1) || a.name.localeCompare(b.name));
};

export const versionsRunningOf = (services: readonly Service[]) =>
  new Set(services.flatMap((service) => (service.running ? [service.running.id] : []))).size;
