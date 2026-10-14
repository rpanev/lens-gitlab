export interface WatchedRepository {
  /** The GitLab host, such as "gitlab.com". Left out, gitlab.com. */
  readonly host?: string;
  /** "group/project", as GitLab writes the path, subgroups included. */
  readonly repository: string;
  /** What is followed: the commits of a branch, or the repository's releases. Left out, as saved before releases, a branch. */
  readonly track?: "branch" | "releases";
  /** The branch followed, when the track is a branch. */
  readonly branch: string;
  /** Whether pre-releases count, when the track is releases. */
  readonly includePrereleases?: boolean;
  /** Which releases count by their tag, such as "v*", when the track is releases; left out, all of them. */
  readonly tagPattern?: string;
  /** How often everything is refreshed while nothing is happening. */
  readonly intervalMinutes: number;
  /**
   * Which changes notify: services going live and failures, failures only, or none. Left out, as saved
   * before notifications, all. Not part of what a watch follows, so changing it keeps what was fetched.
   */
  readonly notify?: "all" | "failures" | "off";
}

export const checkIntervalsInMinutes = [1, 5, 15, 30, 60] as const;

export const isReleasesWatch = (watch: WatchedRepository) => watch.track === "releases";

/** The host a watch reads, gitlab.com when none was saved. */
export const hostOf = (watch: Pick<WatchedRepository, "host">) => (watch.host || "gitlab.com").toLowerCase();

/** A tag GitLab users treat as a pre-release: a release candidate, alpha, beta, or a semver pre-release. */
export const isPrereleaseTag = (tag: string) =>
  /(?:^|[^A-Za-z0-9])(?:alpha|beta|rc|pre|preview|snapshot|dev|nightly)(?:[^A-Za-z0-9]|$)/i.test(tag) ||
  /^v?\d+\.\d+\.\d+-/.test(tag);

/** What one watch follows, for telling two apart and naming it. */
const followedOf = (watch: WatchedRepository) => {
  if (!isReleasesWatch(watch)) return watch.branch;

  const releases = watch.includePrereleases ? "releases and pre-releases" : "releases";

  return watch.tagPattern ? `${releases} matching ${watch.tagPattern}` : releases;
};

/** Whether a tag matches a pattern in which "*" stands for anything, such as "v*" or "artifact-contract/v*". */
export const tagMatches = (pattern: string | undefined, tag: string) =>
  !pattern ||
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(tag);

export const isSameWatch = (a: WatchedRepository, b: WatchedRepository) =>
  hostOf(a) === hostOf(b) && a.repository.toLowerCase() === b.repository.toLowerCase() && followedOf(a) === followedOf(b);

/** What a watch follows, as the user reads it: "main", or "releases and pre-releases". */
export const followedLabelOf = followedOf;

/**
 * A watch as one primitive, which is what keys the data kept for it: two watches alike share it, and
 * a change to any of its settings is another watch.
 */
export const watchKeyOf = (watch: WatchedRepository) =>
  JSON.stringify([
    hostOf(watch),
    watch.repository,
    watch.track ?? "branch",
    watch.branch,
    !!watch.includePrereleases,
    watch.intervalMinutes,
    watch.tagPattern ?? "",
  ]);

export const watchOfKey = (key: string): WatchedRepository => {
  const [host, repository, track, branch, includePrereleases, intervalMinutes, tagPattern] = JSON.parse(key);

  return {
    host: host === "gitlab.com" ? undefined : host,
    repository,
    track,
    branch,
    includePrereleases,
    intervalMinutes,
    tagPattern: tagPattern || undefined,
  };
};
