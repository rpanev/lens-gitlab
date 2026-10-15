import { overallStatusOf } from "./run-status";
import { isStartedByVersion, type Pipeline } from "./pipeline";

/** One version of what a watch follows: a commit of a branch, or a release. Newest first wherever listed. */
export interface Version {
  /** The commit's id, or the release's tag: what identifies it, and what an image is built from. */
  readonly id: string;
  /** What names it in a cell: the short commit id, or the tag. */
  readonly label: string;
  /** The first line of the commit message, or the release's name. */
  readonly title: string;
  /** When it was committed or published. */
  readonly at: string;
  readonly prerelease?: boolean;
  /** Who made the commit: the name they committed with. */
  readonly author?: string;
  /** Its page on GitLab. */
  readonly url: string;
}

export interface VersionRuns {
  readonly version: Version;
  /** The newest run of each pipeline the version started, by name: what its CI status is of. */
  readonly runs: readonly Pipeline[];
  /** Runs recorded against it that it did not start, such as a merge request's: shown apart, counted for nothing. */
  readonly otherRuns: readonly Pipeline[];
  /**
   * The branch the runs ran on, when they are not the version's own: a release with no runs of its own
   * shows those of the commit it was tagged on, as a repository that builds on its default branch has.
   */
  readonly runsOn?: string;
}

const newestOfEachPipeline = (newestFirst: readonly Pipeline[]) =>
  newestFirst
    // A pipeline run again on the same commit replaces what it said before.
    .filter((run, index) => newestFirst.findIndex((each) => each.name === run.name) === index)
    .sort((a, b) => a.name.localeCompare(b.name));

/** A version with the pipelines GitLab lists for it, newest first. */
export const toVersionRuns = (version: Version, newestFirst: readonly Pipeline[], runsOn?: string): VersionRuns => ({
  version,
  runsOn,
  runs: newestOfEachPipeline(newestFirst.filter(isStartedByVersion)),
  otherRuns: newestOfEachPipeline(newestFirst.filter((run) => !isStartedByVersion(run))),
});

/** What names a version's pipelines: "76cd335", or "v1.2.0 · on main" for runs of the commit it was tagged on. */
export const pipelinesTitleOf = (row: VersionRuns) => `${row.version.label}${row.runsOn ? ` · on ${row.runsOn}` : ""}`;

/** What heads a version's pipelines: how many of them passed, and the status that asks most for attention. */
export const summaryOf = (row: Pick<VersionRuns, "runs">) => {
  const total = row.runs.length;

  if (total === 0) return { text: "No pipelines of its own", status: undefined };

  const passed = row.runs.filter((run) => run.conclusion === "success").length;

  return {
    text: `${passed}/${total} ${total === 1 ? "pipeline" : "pipelines"} passed`,
    status: overallStatusOf(row.runs),
  };
};

/** How many versions passed all their pipelines, of those that ran any: one without runs says nothing of CI. */
export const pipelinesPassingOf = (rows: readonly Pick<VersionRuns, "runs">[]) => {
  const ran = rows.filter((row) => row.runs.length > 0);

  return {
    passing: ran.filter((row) => row.runs.every((run) => run.conclusion === "success")).length,
    ran: ran.length,
  };
};
