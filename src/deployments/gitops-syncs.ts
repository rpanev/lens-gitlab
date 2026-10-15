import type { Version } from "../pipelines/version";
import type { ClusterImages, DeployResource, GitSource } from "./cluster-images";
import type { VersionOnTrack } from "./services";

/**
 * A Kustomization or an Argo CD Application applying the watched branch: what it applied, and a newer
 * commit on its way, fetched and not applied yet, being applied, or failed to apply.
 */
export interface GitOpsSync {
  readonly resource: DeployResource;
  readonly source: GitSource;
  /** The commit applied, short when it is not one of the versions watched. */
  readonly applied?: VersionOnTrack;
  readonly pending?: VersionOnTrack & { readonly stage: "fetched" | "applying" | "failed" };
}

const onTrackOf = (
  sha: string | undefined,
  host: string,
  repository: string,
  versions: readonly Version[],
): VersionOnTrack | undefined => {
  if (!sha) return undefined;

  const behind = versions.findIndex((version) => version.id === sha);

  // A commit older than the versions watched is still named, as far behind as can be told.
  return behind === -1
    ? {
        id: sha,
        label: sha.slice(0, 7),
        at: "",
        behind: versions.length,
        url: `https://${host}/${repository}/-/commit/${sha}`,
      }
    : { id: sha, label: versions[behind].label, at: versions[behind].at, behind, url: versions[behind].url };
};

const pendingOf = (resource: DeployResource, source: GitSource) => {
  const { appliedCommit, attemptedCommit, state } = resource;

  if (state === "failed") return { commit: attemptedCommit ?? source.commit, stage: "failed" as const };
  if (state === "reconciling") return { commit: source.commit ?? attemptedCommit, stage: "applying" as const };
  if (source.commit && source.commit !== appliedCommit) return { commit: source.commit, stage: "fetched" as const };

  return undefined;
};

/**
 * What applies a repository's branch in the cluster, most behind first: the Kustomizations of a
 * GitRepository following it, and the Argo CD Applications whose source it is.
 */
export const gitOpsSyncsOf = (
  repository: string,
  branch: string,
  versions: readonly Version[],
  { deployResources, gitSources }: ClusterImages,
  host = "gitlab.com",
): GitOpsSync[] => {
  // An Application following "HEAD" follows the repository's default branch, which is not known here: it is
  // taken to be the branch watched.
  const isWatched = (source: GitSource, resource: DeployResource) =>
    source.repository === repository.toLowerCase() &&
    (source.host ?? "gitlab.com").toLowerCase() === host.toLowerCase() &&
    (source.branch === branch || (source.branch === undefined && source === resource.inlineSource));

  // An Application names its source itself; a Kustomization through the GitRepository it refers to.
  const sourceOf = (resource: DeployResource) =>
    resource.inlineSource ??
    gitSources.find(
      (each) =>
        resource.sourceRef?.kind === "GitRepository" &&
        each.namespace === resource.sourceRef.namespace &&
        each.name === resource.sourceRef.name,
    );

  return deployResources
    .flatMap((resource): GitOpsSync[] => {
      const source = sourceOf(resource);

      if (!source || !isWatched(source, resource)) return [];

      const pending = pendingOf(resource, source);
      const pendingOnTrack = onTrackOf(pending?.commit, host, repository, versions);

      return [
        {
          resource,
          source,
          applied: onTrackOf(resource.appliedCommit, host, repository, versions),
          // Failing counts even on the applied commit: applying it again is what fails.
          pending:
            pending && pendingOnTrack && (pending.stage === "failed" || pendingOnTrack.id !== resource.appliedCommit)
              ? { ...pendingOnTrack, stage: pending.stage }
              : undefined,
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(!!b.pending) - Number(!!a.pending) ||
        (b.applied?.behind ?? 0) - (a.applied?.behind ?? 0) ||
        a.resource.name.localeCompare(b.resource.name),
    );
};

/** One Kustomization or Application as it stands for one version. */
export interface VersionSync {
  readonly name: string;
  readonly state: "running" | "rolling-out" | "picked-up" | "failed";
  readonly sync: GitOpsSync;
}

const pendingStates = { fetched: "picked-up", applying: "rolling-out", failed: "failed" } as const;

/** What applied, is applying, fetched, or failed to apply one version. */
export const syncsOfVersion = (id: string, syncs: readonly GitOpsSync[]): VersionSync[] =>
  syncs.flatMap((sync): VersionSync[] => {
    const name = sync.resource.name;

    if (sync.pending?.id === id) return [{ name, state: pendingStates[sync.pending.stage], sync }];
    if (sync.applied?.id === id) return [{ name, state: "running", sync }];

    return [];
  });
