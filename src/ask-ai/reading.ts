import type { DashboardHealth } from "../dashboard/dashboard-health.injectable";
import type { VersionRow } from "../dashboard/watch-on-cluster.injectable";
import { serviceStatusOf, syncStatusOf } from "../dashboard/flux-stage";
import type { ClusterImagesState } from "../deployments/cluster-images.injectable";
import { urlOnHost } from "../pipelines/browser-url";
import { projectInputOf } from "../watched-repositories/watch-input";
import { followedLabelOf, hostOf, isReleasesWatch, type WatchedRepository } from "../watched-repositories/watched-repository";
import { summaryOf } from "../pipelines/version";
import type { TrackActivityState } from "../pipelines/track-activity.injectable";

const bannerLabels: Record<DashboardHealth["state"] | "not-configured", string> = {
  checking: "Checking",
  unreachable: "Unreachable",
  failing: "Failing",
  deploying: "Deploying",
  behind: "Behind",
  "up-to-date": "Up to date",
  "nothing-deployed": "Not deployed",
  "not-configured": "Not configured",
};

export interface WatchedProjectReading {
  readonly host: string;
  readonly project: string;
  readonly follows: string;
  readonly track: "branch" | "releases";
  readonly branch: string;
  readonly includePrereleases: boolean | null;
  readonly tagPattern: string | null;
  readonly intervalMinutes: number;
  readonly notify: "all" | "failures" | "off";
}

export const projectReadingOf = (watch: WatchedRepository): WatchedProjectReading => ({
  host: hostOf(watch),
  project: watch.repository,
  follows: followedLabelOf(watch),
  track: watch.track ?? "branch",
  branch: watch.branch,
  includePrereleases: watch.track === "releases" ? (watch.includePrereleases ?? true) : null,
  tagPattern: watch.tagPattern ?? null,
  intervalMinutes: watch.intervalMinutes,
  notify: watch.notify ?? "all",
});

export interface ClusterStatusReading {
  readonly ready: boolean;
  readonly state: DashboardHealth["state"] | "not-configured" | null;
  readonly label: string;
  readonly message: string;
  readonly projects: readonly WatchedProjectReading[];
}

/** The banner and the watched list, as Ask AI relays them. Nothing watched is not "not deployed". */
export const clusterStatusReadingOf = (
  watches: readonly WatchedRepository[] | undefined,
  health: DashboardHealth,
): ClusterStatusReading => {
  if (!watches)
    return {
      ready: false,
      state: null,
      label: "Checking",
      message: "The watched projects of this cluster are still being read.",
      projects: [],
    };

  if (watches.length === 0)
    return {
      ready: true,
      state: "not-configured",
      label: bannerLabels["not-configured"],
      message: "No GitLab project is watched on this cluster.",
      projects: [],
    };

  return {
    ready: true,
    state: health.state,
    label: bannerLabels[health.state],
    message: health.message,
    projects: watches.map(projectReadingOf),
  };
};

export interface VersionPipelineReading {
  readonly label: string;
  readonly title: string;
  readonly at: string;
  readonly url: string;
  readonly prerelease: boolean;
  readonly pipelineSummary: string;
  readonly pipelineStatus: string | null;
  readonly pipelines: readonly { readonly name: string; readonly status: string; readonly url: string | null }[];
  /** How each service of the cluster stands for this version. Empty while the cluster is still being read. */
  readonly services: readonly { readonly name: string; readonly status: string }[];
  /** The Kustomization or Argo CD Application at this version. */
  readonly syncs: readonly { readonly kind: string; readonly name: string; readonly status: string }[];
}

export interface ProjectPipelinesReading {
  readonly host: string;
  readonly project: string;
  readonly follows: string;
  readonly gitlab: "loaded" | "checking" | "unreachable";
  readonly problem: string | null;
  readonly cluster: "loaded" | "checking" | "unreachable";
  readonly clusterProblem: string | null;
  readonly versions: readonly VersionPipelineReading[];
}

const gitlabOf = (
  activity: TrackActivityState,
): Pick<ProjectPipelinesReading, "gitlab" | "problem"> => {
  if (activity.status === "failed")
    return { gitlab: "unreachable", problem: `${activity.problem.title} ${activity.problem.fix}` };
  if (activity.status === "loading") return { gitlab: "checking", problem: null };

  return {
    gitlab: "loaded",
    problem: activity.warning ? `${activity.warning.title} ${activity.warning.fix}` : null,
  };
};

const clusterOf = (cluster: ClusterImagesState): Pick<ProjectPipelinesReading, "cluster" | "clusterProblem"> => {
  if (cluster.status === "failed") return { cluster: "unreachable", clusterProblem: cluster.message };
  if (cluster.status === "loading") return { cluster: "checking", clusterProblem: null };

  return { cluster: "loaded", clusterProblem: null };
};

/** The watches of one project, or why none match. `follows` narrows a project watched more than once. */
export const watchedMatching = (
  watches: readonly WatchedRepository[],
  project: string,
  host?: string,
  follows?: string,
): { readonly watches: readonly WatchedRepository[] } | { readonly error: string } => {
  if (project.trim() === "") return { error: 'Name the project as "group/project".' };

  const parsed = projectInputOf(project, host ?? "gitlab.com");
  const ofProject = watches.filter(
    (watch) => hostOf(watch) === parsed.host && watch.repository.toLowerCase() === parsed.project.toLowerCase(),
  );
  const names = (each: readonly WatchedRepository[]) => each.map((watch) => followedLabelOf(watch)).join(", ");

  if (ofProject.length === 0) {
    const watched = watches.map((watch) => `${watch.repository} (${followedLabelOf(watch)}) on ${hostOf(watch)}`);

    return {
      error: `${parsed.project} on ${parsed.host} is not watched.${watched.length > 0 ? ` Watched: ${watched.join("; ")}.` : ""}`,
    };
  }

  const wanted = follows?.trim().toLowerCase();

  if (!wanted) return { watches: ofProject };

  const narrowed = ofProject.filter(
    (watch) =>
      followedLabelOf(watch).toLowerCase() === wanted ||
      ((watch.track ?? "branch") === "branch" && watch.branch.toLowerCase() === wanted),
  );

  if (narrowed.length === 0)
    return { error: `${parsed.project} on ${parsed.host} is watched as ${names(ofProject)}, not "${follows}".` };

  return { watches: narrowed };
};

/** One watched project's latest commits or releases, with pipeline and cluster status. */
export const projectPipelinesReadingOf = (
  watch: WatchedRepository,
  activity: TrackActivityState,
  cluster: ClusterImagesState,
  rows: readonly VersionRow[],
): ProjectPipelinesReading => {
  const unit = isReleasesWatch(watch) ? "release" : "commit";
  const gitlab = gitlabOf(activity);
  const host = hostOf(watch);

  return {
    host,
    project: watch.repository,
    follows: followedLabelOf(watch),
    ...gitlab,
    ...clusterOf(cluster),
    versions:
      gitlab.gitlab === "loaded"
        ? rows.map((row) => {
            const summary = summaryOf(row);

            return {
              label: row.version.label,
              title: row.version.title,
              at: row.version.at,
              url: urlOnHost(row.version.url, host) ?? "",
              prerelease: !!row.version.prerelease,
              pipelineSummary: row.runsOn ? `${summary.text} (on ${row.runsOn})` : summary.text,
              pipelineStatus: summary.status?.label ?? null,
              pipelines: row.runs.map((run) => ({
                name: run.name,
                status: summaryOf({ runs: [run] }).status?.label ?? run.conclusion,
                url: urlOnHost(run.url, host) ?? null,
              })),
              services: (row.services ?? []).map((each) => ({
                name: each.name,
                status: serviceStatusOf({ ...each.service, unit }),
              })),
              syncs: (row.syncs ?? []).map((each) => ({
                kind: each.sync.resource.kind,
                name: each.name,
                status: syncStatusOf(each.sync),
              })),
            };
          })
        : [],
  };
};
