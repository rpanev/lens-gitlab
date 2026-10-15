import { getKubeResourceKind, getKubernetesApiVersion } from "@k8slens/kubernetes-contracts";
import type { DeployResource, OwnerRef } from "./cluster-images";
import { gitProjectOfUrl } from "./git-url";

export const argoprojV1alpha1 = getKubernetesApiVersion("argoproj.io/v1alpha1");

interface ApplicationSource {
  readonly repoURL: string;
  /** A branch, a tag, a commit, or "HEAD"; for a chart from a chart repository, its version. */
  readonly targetRevision?: string;
  readonly path?: string;
  /** For a chart from a chart repository. */
  readonly chart?: string;
}

export interface ApplicationStatus {
  readonly sync?: { readonly status?: string; readonly revision?: string; readonly revisions?: readonly string[] };
  readonly health?: { readonly status?: string; readonly message?: string };
  readonly operationState?: {
    readonly phase?: string;
    readonly message?: string;
    readonly finishedAt?: string;
    readonly operation?: { readonly sync?: { readonly revision?: string; readonly revisions?: readonly string[] } };
    readonly syncResult?: { readonly revision?: string; readonly revisions?: readonly string[] };
  };
  readonly history?: readonly {
    readonly revision?: string;
    readonly revisions?: readonly string[];
    readonly deployedAt?: string;
  }[];
  readonly conditions?: readonly { readonly type: string; readonly message?: string }[];
}

/** Argo CD's Application: what it deploys from where, and how far it has got. */
export const applicationKind = getKubeResourceKind<{
  "argoproj.io/v1alpha1": {
    kind: "Application";
    metadata: { name: string; namespace: string };
    spec: { source?: ApplicationSource; sources?: readonly ApplicationSource[] };
    status?: ApplicationStatus;
  };
}>("Application");

// A multi-source Application is followed by its first source, the one its revision comes first for.
const first = (one?: string, many?: readonly string[]) => one || many?.[0];

/**
 * Reads an Application's status the way Flux's conditions are read: failing when a sync failed, the
 * Application is degraded or Argo CD reports an error about it; reconciling while a sync runs or what
 * it deployed is still progressing; ready otherwise, a newer commit to sync included.
 */
export const argoStateOf = ({ operationState, health, conditions }: ApplicationStatus = {}): Pick<
  DeployResource,
  "state" | "message"
> => {
  const error = conditions?.find((condition) => condition.type.endsWith("Error"));

  if (operationState?.phase === "Failed" || operationState?.phase === "Error")
    return { state: "failed", message: operationState.message };
  if (error) return { state: "failed", message: error.message };
  // Argo CD often gives no message for a degraded Application, such as one whose pods crash.
  if (health?.status === "Degraded") return { state: "failed", message: health.message || "Degraded" };
  if (operationState?.phase === "Running" || operationState?.phase === "Terminating")
    return { state: "reconciling", message: operationState.message };
  // "Missing" is what a manually synced Application never synced reads: out of sync, not under way.
  if (health?.status === "Progressing") return { state: "reconciling", message: health.message };

  return { state: "ready" };
};

/** The commits an Application applied, tried last, and compared last (what it is to deploy). */
export const argoCommitsOf = ({ operationState, history, sync }: ApplicationStatus = {}) => {
  const lastSync = operationState?.syncResult;
  const succeeded = operationState?.phase === "Succeeded";
  const lastDeployed = history?.at(-1);

  return {
    applied: succeeded
      ? first(lastSync?.revision, lastSync?.revisions)
      : first(lastDeployed?.revision, lastDeployed?.revisions),
    attempted:
      first(lastSync?.revision, lastSync?.revisions) ??
      first(operationState?.operation?.sync?.revision, operationState?.operation?.sync?.revisions),
    target: first(sync?.revision, sync?.revisions),
  };
};

/** When Argo CD deployed a revision: its history entry, or the sync that just succeeded. */
export const argoAppliedAt = (status: ApplicationStatus | undefined, applied?: string) => {
  const entry = status?.history?.find(
    (item) => item.deployedAt && (item.revision === applied || item.revisions?.includes(applied ?? "")),
  );

  if (entry?.deployedAt) return entry.deployedAt;
  if (status?.operationState?.phase === "Succeeded") return status.operationState.finishedAt;

  return undefined;
};

const isCommitId = (revision?: string) => !!revision && /^[0-9a-f]{40}$/.test(revision);

/** The branch a target revision names; none for "HEAD" or nothing, which follow the repository's default branch. */
const branchOf = (revision?: string) =>
  !revision || revision === "HEAD" ? undefined : revision.replace(/^refs\/heads\//, "");

/** The Application as a deployer, with its Git source when it deploys from a Git repository. */
export const applicationResourceOf = (application: {
  metadata: { name: string; namespace: string };
  spec: { source?: ApplicationSource; sources?: readonly ApplicationSource[] };
  status?: ApplicationStatus;
}): DeployResource => {
  const source = application.spec.source ?? application.spec.sources?.[0];
  const { applied, attempted, target } = argoCommitsOf(application.status);
  const fromChartRepository = !!source?.chart;
  const project = source && !fromChartRepository ? gitProjectOfUrl(source.repoURL) : undefined;

  return {
    kind: "Application",
    apiVersion: argoprojV1alpha1,
    namespace: application.metadata.namespace,
    name: application.metadata.name,
    ...argoStateOf(application.status),
    revision: target ?? applied,
    appliedCommit: isCommitId(applied) ? applied : undefined,
    attemptedCommit: isCommitId(attempted) ? attempted : undefined,
    inlineSource: project
      ? {
          namespace: application.metadata.namespace,
          name: application.metadata.name,
          repository: project.project,
          host: project.host,
          branch: branchOf(source?.targetRevision),
          commit: isCommitId(target) ? target : undefined,
        }
      : undefined,
    // A chart from a chart repository is at a version: what was synced, and what is to be.
    chart: fromChartRepository ? { applied: applied ?? target, attempted: target } : undefined,
    appliedAt: argoAppliedAt(application.status, applied),
  };
};

/**
 * The Application a resource belongs to, by Argo CD's tracking annotation ("<app>:<group>/<kind>:<ns>/<name>",
 * the app prefixed by "<namespace>_" when Applications live in more than one namespace) or, with label
 * tracking, by its instance label. The namespace is left empty when the tracking does not say it.
 */
export const argoOwnerOf = (
  labels: Readonly<Record<string, string>> = {},
  annotations: Readonly<Record<string, string>> = {},
): OwnerRef | undefined => {
  const tracked = annotations["argocd.argoproj.io/tracking-id"]?.split(":")[0];
  const application = tracked || labels["app.kubernetes.io/instance"];

  if (!application) return undefined;

  const [namespace, name] = application.includes("_") ? application.split("_", 2) : ["", application];

  return { kind: "Application", namespace, name };
};
