import { z } from "zod";

const deploymentSchema = z.object({
  status: z.string().nullish(),
  sha: z.string().nullish(),
  ref: z.string().nullish(),
  environment: z.object({ name: z.string() }).nullish(),
});

export const deploymentsSchema = z.array(deploymentSchema);

/** Successful deployments, newest id first: the first of an environment is the one GitLab last deployed. */
export const deploymentsPathOf = (project: string) =>
  `projects/${encodeURIComponent(project)}/deployments?${new URLSearchParams({
    status: "success",
    order_by: "id",
    sort: "desc",
    per_page: "100",
  })}`;

export interface GitlabDeployment {
  readonly environment: string;
  readonly sha: string;
  readonly ref?: string;
}

export interface EnvironmentDrift {
  readonly environment: string;
  /** What GitLab last deployed there, as a version label when the sha is one that is watched. */
  readonly gitlab: string;
  /** The deployed commit, for the compare a drift opens. */
  readonly gitlabSha: string;
  readonly clusterName?: string;
  /** What the matching cluster runs. Absent when that cluster runs nothing of the project. */
  readonly running?: string;
  readonly runningId?: string;
  /** The branch the matching cluster follows, so the compare lists that branch's merge requests. */
  readonly branch?: string;
  readonly drift: boolean;
}

/** Branches a production deploy is cut from, when the cluster's name does not say so. */
const productionBranches = new Set(["main", "master", "prod", "production"]);

export const isProductionBranch = (branch: string) => productionBranches.has(branch.toLowerCase());

const canonical: Record<string, string> = {
  development: "dev",
  develop: "dev",
  staging: "stage",
  stg: "stage",
  qa: "stage",
  uat: "stage",
  test: "stage",
  production: "prod",
  prd: "prod",
  live: "prod",
};

const wordsOf = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => canonical[word] ?? word);

/** Whether a cluster's name and a GitLab environment name are the same place, as "prod-eu" and "production". */
export const sameEnvironment = (clusterName: string, environmentName: string) => {
  const cluster = new Set(wordsOf(clusterName));

  return wordsOf(environmentName).some((word) => cluster.has(word));
};

const isProductionEnvironment = (name: string) => wordsOf(name).includes("prod");

export interface EnvironmentCluster {
  readonly name: string;
  /** The branch this cluster's watch follows. Production also matches main, master and prod. */
  readonly branch?: string;
  /** The cluster whose dashboard is open. It wins a production branch when no name matches. */
  readonly current?: boolean;
  readonly runningId?: string;
  readonly runningLabel?: string;
}

/**
 * The cluster an environment is about. A name match wins. Production otherwise takes the open cluster
 * when it follows main, master or prod, which is where that deploy is cut from.
 */
export const clusterForEnvironment = (environmentName: string, clusters: readonly EnvironmentCluster[]) => {
  const named = clusters.find((each) => sameEnvironment(each.name, environmentName));

  if (named || !isProductionEnvironment(environmentName)) return named;

  const onProductionBranch = clusters.filter((each) => each.branch !== undefined && isProductionBranch(each.branch));

  return onProductionBranch.find((each) => each.current) ?? onProductionBranch[0];
};

/** From the older of the two commits to the newer, so the list is what one side does not have yet. */
export const driftRangeOf = (
  runningId: string,
  gitlabSha: string,
  versions: readonly { id: string }[],
) => {
  const indexOf = (id: string) =>
    versions.findIndex((version) => {
      const each = version.id.toLowerCase();
      const want = id.toLowerCase();

      return each === want || each.startsWith(want) || want.startsWith(each);
    });
  const runningAt = indexOf(runningId);
  const gitlabAt = indexOf(gitlabSha);

  // Versions are newest first, so the greater index is the older commit.
  if (runningAt >= 0 && gitlabAt >= 0 && gitlabAt > runningAt) return { from: gitlabSha, to: runningId };

  return { from: runningId, to: gitlabSha };
};

/** The newest successful deployment of each environment, in the order GitLab returned them. */
export const latestDeploymentsOf = (deployments: z.infer<typeof deploymentsSchema>): GitlabDeployment[] => {
  const seen = new Set<string>();
  const latest: GitlabDeployment[] = [];

  for (const deployment of deployments) {
    const name = deployment.environment?.name;
    const sha = deployment.sha;

    if (!name || !sha || seen.has(name)) continue;
    if (deployment.status && deployment.status !== "success") continue;

    seen.add(name);
    latest.push({ environment: name, sha, ref: deployment.ref ?? undefined });
  }

  return latest;
};

const looksLikeTag = (ref: string) => /^v?\d/.test(ref);

const versionLabelOf = (sha: string, ref: string | undefined, versions: readonly { id: string; label: string }[]) => {
  const id = sha.toLowerCase();
  const match = versions.find((version) => {
    const each = version.id.toLowerCase();

    return each === id || each.startsWith(id) || id.startsWith(each);
  });

  if (match) return match.label;
  if (ref && looksLikeTag(ref)) return ref;

  return sha.slice(0, 7);
};

const sameVersion = (sha: string, ref: string | undefined, runningId: string) => {
  const deployed = sha.toLowerCase();
  const running = runningId.toLowerCase();

  if (deployed === running || deployed.startsWith(running) || running.startsWith(deployed)) return true;
  if (!ref) return false;

  const tag = ref.toLowerCase();

  return tag === running || tag === `v${running}` || `v${tag}` === running;
};

/**
 * GitLab's last deployment of each environment beside the cluster of the same name. Drift is GitLab and
 * the cluster naming different versions.
 */
export const environmentDriftOf = (
  deployments: readonly GitlabDeployment[],
  clusters: readonly EnvironmentCluster[],
  versions: readonly { id: string; label: string }[],
): EnvironmentDrift[] =>
  deployments.map((deployment) => {
    const cluster = clusterForEnvironment(deployment.environment, clusters);
    const matches = cluster?.runningId !== undefined && sameVersion(deployment.sha, deployment.ref, cluster.runningId);

    return {
      environment: deployment.environment,
      gitlab: versionLabelOf(deployment.sha, deployment.ref, versions),
      gitlabSha: deployment.sha,
      clusterName: cluster?.name,
      running: cluster?.runningLabel,
      runningId: cluster?.runningId,
      branch: cluster?.branch,
      drift: cluster?.runningId !== undefined && !matches,
    };
  });
