import type { KubernetesApiVersion } from "@k8slens/kubernetes-contracts";
import type { Condition } from "./flux-kinds";

/** The Kustomization, HelmRelease or Argo CD Application that applies something. */
export interface OwnerRef {
  readonly kind: "Kustomization" | "HelmRelease" | "Application";
  readonly namespace: string;
  readonly name: string;
}

export interface Workload {
  readonly kind: "Deployment" | "StatefulSet" | "DaemonSet";
  readonly namespace: string;
  readonly name: string;
  readonly images: readonly string[];
  /** Every replica runs the current template. */
  readonly rolledOut: boolean;
  /** How many of its replicas are ready, of how many it wants. */
  readonly replicas?: { readonly ready: number; readonly desired: number };
  /**
   * When it last settled with every replica updated and available, for a Deployment: after its last rollout,
   * or after a scale or a replica coming back since, whichever came last.
   */
  readonly settledAt?: string;
  /** When the ReplicaSet of these images was created: the rollout Kubernetes still remembers. */
  readonly rolloutStartedAt?: string;
  /** The rollout hit ProgressDeadlineExceeded. */
  readonly stalled?: boolean;
  readonly owner?: OwnerRef;
  /**
   * Git commits from `org.opencontainers.image.revision` on the workload or its pod template, for an image
   * pinned by digest or tagged latest.
   */
  readonly revisions?: readonly string[];
}

export interface ImageSelection {
  readonly namespace: string;
  readonly name: string;
  readonly image: string;
}

/** What a HelmRelease has installed and is installing. */
export interface ReleasedChart {
  /** The HelmChart it installs from, as "namespace/name". */
  readonly helmChart?: string;
  /** The chart version installed last. */
  readonly applied?: string;
  /** The chart version tried last, the same as the applied one unless installing it is under way or failed. */
  readonly attempted?: string;
}

export interface DeployResource extends OwnerRef {
  /** The version the cluster serves it in, which is what opening its details asks for. */
  readonly apiVersion: KubernetesApiVersion;
  /** For a HelmRelease. */
  readonly chart?: ReleasedChart;
  /** For an Argo CD Application: the repository and branch it deploys, and the commit it compared last. */
  readonly inlineSource?: GitSource;
  /** For a Kustomization: the source it applies; for both, the commits it applied and tried last. */
  readonly sourceRef?: { readonly kind: string; readonly namespace: string; readonly name: string };
  readonly appliedCommit?: string;
  readonly attemptedCommit?: string;
  readonly state: "ready" | "reconciling" | "failed";
  /**
   * For a Flux resource: those of its kind it depends on, which Flux applies it only after. While one of
   * them is not ready, it waits; it is failing only when what it waits for is.
   */
  readonly dependsOn?: readonly OwnerRef[];
  /** It waits for what it depends on, rather than failing itself. */
  readonly waitsForDependency?: boolean;
  readonly message?: string;
  readonly revision?: string;
  /** When Flux or Argo CD applied the revision it is at now. */
  readonly appliedAt?: string;
}

/** A Git repository Flux fetches. */
export interface GitSource {
  readonly namespace: string;
  readonly name: string;
  /** "group/project", when the URL names one. */
  readonly repository?: string;
  /** The host the URL names, such as "gitlab.com". */
  readonly host?: string;
  readonly branch?: string;
  /** The commit fetched last. */
  readonly commit?: string;
}

export interface HelmChart {
  readonly namespace: string;
  readonly name: string;
  /** The chart version built last. */
  readonly version?: string;
  /** The commit it was built from, for a chart in a Git repository. */
  readonly sourceCommit?: string;
}

export interface ImageAutomation {
  readonly namespace: string;
  readonly name: string;
  readonly lastPushTime?: string;
  readonly lastPushCommit?: string;
}

/** What a cluster runs, what Flux has selected to run, and how Flux is getting it there. */
export interface ClusterImages {
  readonly workloads: readonly Workload[];
  readonly imageSelections: readonly ImageSelection[];
  readonly deployResources: readonly DeployResource[];
  readonly imageAutomations: readonly ImageAutomation[];
  readonly helmCharts: readonly HelmChart[];
  readonly gitSources: readonly GitSource[];
  /** ReplicaSets still kept for Deployments, newest images included: rollout times from before Lens was open. */
  readonly replicaSets?: readonly ReplicaRollout[];
}

/** A Deployment's ReplicaSet, as far as a lead time needs it. */
export interface ReplicaRollout {
  readonly namespace: string;
  readonly ownerName: string;
  readonly images: readonly string[];
  readonly createdAt: string;
}

const sameImages = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((image) => right.includes(image));

/** The ReplicaSet creation time of a Deployment's current images, which Kubernetes keeps after Lens was closed. */
export const withReplicaSets = (workloads: readonly Workload[], replicaSets: readonly ReplicaRollout[] = []): Workload[] =>
  workloads.map((workload) => {
    if (workload.kind !== "Deployment") return workload;

    const createdAt = replicaSets
      .filter(
        (set) =>
          set.namespace === workload.namespace &&
          set.ownerName === workload.name &&
          sameImages(set.images, workload.images),
      )
      .map((set) => set.createdAt)
      .sort()
      .at(-1);

    return createdAt ? { ...workload, rolloutStartedAt: createdAt } : workload;
  });

export const fluxOwnerOf = (labels: Readonly<Record<string, string>> = {}): OwnerRef | undefined => {
  const helmRelease = labels["helm.toolkit.fluxcd.io/name"];
  const kustomization = labels["kustomize.toolkit.fluxcd.io/name"];

  // A HelmRelease is the nearer owner: it is usually applied by a Kustomization itself.
  if (helmRelease)
    return { kind: "HelmRelease", name: helmRelease, namespace: labels["helm.toolkit.fluxcd.io/namespace"] ?? "" };
  if (kustomization)
    return {
      kind: "Kustomization",
      name: kustomization,
      namespace: labels["kustomize.toolkit.fluxcd.io/namespace"] ?? "",
    };

  return undefined;
};

export const fluxStateOf = (
  conditions: readonly Condition[] = [],
): Pick<DeployResource, "state" | "message" | "waitsForDependency"> => {
  const ready = conditions.find((condition) => condition.type === "Ready");
  const reconciling = conditions.find((condition) => condition.type === "Reconciling" && condition.status === "True");

  // Waiting for what it depends on is not failing: it applies once that is ready, if it gets ready.
  if (ready?.status === "False" && ready.reason === "DependencyNotReady")
    return { state: "reconciling", message: ready.message, waitsForDependency: true };
  // Reconciling again after failing is failing, retried: Flux says so with "ProgressingWithRetry".
  if (reconciling?.reason === "ProgressingWithRetry" && ready?.status === "False")
    return { state: "failed", message: ready.message };
  if (reconciling || !ready || ready.status === "Unknown") return { state: "reconciling", message: ready?.message };

  return { state: ready.status === "True" ? "ready" : "failed", message: ready.message };
};

/**
 * Flux resources waiting for something they depend on that fails to apply, or is not there, as failing
 * with it: what fails is named, along the chain when what it waits for waits too. Waiting for something only
 * being applied stays waiting.
 */
export const withFailingDependencies = (resources: readonly DeployResource[]): DeployResource[] => {
  const find = (ref: OwnerRef) => resources.find((each) => each.kind === ref.kind && isSameOwner(each, ref));

  /** Why it cannot be applied, when that is something failing rather than something to wait for. */
  const failureOf = (resource: DeployResource, seen: ReadonlySet<DeployResource>): string | undefined => {
    if (!resource.waitsForDependency)
      return resource.state === "failed"
        ? `${resource.namespace}/${resource.name}, which fails to apply: ${resource.message ?? "no message"}`
        : undefined;

    for (const ref of resource.dependsOn ?? []) {
      const dependency = find(ref);

      // Not found may be not listed, for someone who cannot see its namespace: it is not said to be absent.
      if (!dependency) return `${ref.namespace}/${ref.name}, which is not found`;
      if (seen.has(dependency)) continue;

      const failure = failureOf(dependency, new Set([...seen, dependency]));

      if (failure) return failure;
    }

    return undefined;
  };

  return resources.map((resource) => {
    const failure = resource.waitsForDependency ? failureOf(resource, new Set([resource])) : undefined;

    // It tried no revision while waiting: what it fails to apply is what its source has, not what it tried last.
    return failure
      ? { ...resource, state: "failed", attemptedCommit: undefined, message: `Waiting for ${failure}` }
      : resource;
  });
};

// Argo CD's tracking may not say which namespace an Application is in, and then its name alone tells it.
export const isSameOwner = (a: OwnerRef, b: OwnerRef) =>
  a.kind === b.kind && a.name === b.name && (a.namespace === b.namespace || !a.namespace || !b.namespace);

const tagOf = (image: string) => {
  const withoutDigest = image.split("@")[0];
  const lastSegment = withoutDigest.slice(withoutDigest.lastIndexOf("/") + 1);

  return lastSegment.includes(":") ? lastSegment.slice(lastSegment.indexOf(":") + 1) : "";
};

/** What an image is of, without its registry and tag: "lens-cloud-backend" for "….amazonaws.com/lens-cloud-backend:main-76cd335". */
export const imageNameOf = (image: string) => {
  const withoutDigest = image.split("@")[0];
  const lastSegment = withoutDigest.slice(withoutDigest.lastIndexOf("/") + 1);

  return lastSegment.split(":")[0];
};

/** Whether an image's tag names the commit, in full or abbreviated, as in "main-76cd335" or "sha-76cd335…". */
export const imageIsOfCommit = (image: string, sha: string) =>
  tagOf(image)
    .split(/[^0-9a-f]+/i)
    .some((word) => word.length >= 7 && sha.toLowerCase().startsWith(word.toLowerCase()));

/** The OCI revision, as a pod annotation or label, when a deploy pins the image by digest or uses `latest`. */
export const imageRevisionKey = "org.opencontainers.image.revision";

/** Whether the tag does not name a build, so the revision annotation is what can. */
export const imageNeedsRevision = (image: string) => {
  if (image.toLowerCase().includes("@sha256:")) return true;

  const tag = tagOf(image);

  return tag === "" || tag.toLowerCase() === "latest";
};

/** Whether an OCI revision is the commit, in full or abbreviated to at least 7 characters. */
export const revisionIsOfCommit = (revision: string, sha: string) =>
  /^[0-9a-f]{7,}$/i.test(revision) && sha.toLowerCase().startsWith(revision.toLowerCase());

/** Revisions named on a workload and on the pod template it creates. */
export const imageRevisionsOf = (
  ...sources: ({ annotations?: Readonly<Record<string, string>>; labels?: Readonly<Record<string, string>> } | undefined)[]
): string[] => [
  ...new Set(
    sources.flatMap((source) => {
      const revision = (source?.annotations?.[imageRevisionKey] ?? source?.labels?.[imageRevisionKey])?.trim();

      return revision ? [revision] : [];
    }),
  ),
];

const withoutV = (tag: string) => tag.replace(/^v(?=\d)/, "");

/** Whether an image's tag is the release's tag, with or without a leading "v": "backend:v2026.9.3-rc.1" for "v2026.9.3-rc.1". */
export const imageIsOfRelease = (image: string, tag: string) => {
  const imageTag = tagOf(image);

  return imageTag !== "" && withoutV(imageTag) === withoutV(tag);
};
