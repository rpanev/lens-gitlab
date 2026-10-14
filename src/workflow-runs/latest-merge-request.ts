import { z } from "zod";
import { browserUrlOf } from "./browser-url";
import { overallStatusOf, type RunStatus, runStatusOf } from "./run-status";
import { runStateOf, type WorkflowRun } from "./workflow-run";

const mergeRequestSchema = z.object({
  iid: z.number(),
  title: z.string(),
  state: z.string(),
  target_branch: z.string(),
  sha: z.string().nullish(),
  merge_commit_sha: z.string().nullish(),
  head_pipeline: z
    .object({
      status: z.string(),
    })
    .nullish(),
});

export interface LatestMergeRequest {
  readonly iid: number;
  readonly title: string;
  /** Open, or already merged into the branch. */
  readonly state: "opened" | "merged";
  readonly targetBranch: string;
  /** The source branch's head, and the commit the merge created on the target branch. */
  readonly sha?: string;
  readonly mergeCommitSha?: string;
  /** None when GitLab did not attach a pipeline to the merge request itself. */
  readonly pipeline?: RunStatus;
  /** The project page, for a failed merge request. */
  readonly projectUrl?: string;
}

/** A commit of the watched branch, newest first, with the pipelines it started. */
export interface BranchCommit {
  readonly id: string;
  readonly title: string;
  readonly runs: readonly WorkflowRun[];
}

export interface MergeStanding {
  readonly text: string;
  readonly color: "success" | "critical" | "warning" | "primary" | "textMuted";
  readonly detail?: string;
  readonly projectUrl?: string;
  readonly failed: boolean;
}

/** The project on its GitLab host, when that page can be opened. */
export const projectUrlOf = (host: string, project: string) => browserUrlOf(`https://${host}/${project}`);

const followed = (state: string): state is LatestMergeRequest["state"] => state === "opened" || state === "merged";

const requestOf = (host: string, project: string, request: z.infer<typeof mergeRequestSchema>): LatestMergeRequest => {
  const pipeline = request.head_pipeline;

  return {
    iid: request.iid,
    title: request.title,
    state: request.state as LatestMergeRequest["state"],
    targetBranch: request.target_branch,
    sha: request.sha ?? undefined,
    mergeCommitSha: request.merge_commit_sha ?? undefined,
    pipeline: pipeline ? runStatusOf(runStateOf(pipeline.status)) : undefined,
    projectUrl: projectUrlOf(host, project),
  };
};

/**
 * The latest merge request into the branch, from a list GitLab returned newest first.
 * A merged one is what landed on the branch, so it wins over an open one updated later.
 * A closed one is skipped.
 */
export const latestMergeRequestOf = (
  host: string,
  project: string,
  requests: readonly unknown[],
): LatestMergeRequest | undefined => {
  const followedRequests = requests.flatMap((request) => {
    const parsed = mergeRequestSchema.safeParse(request);

    return parsed.success && followed(parsed.data.state) ? [requestOf(host, project, parsed.data)] : [];
  });

  return (
    followedRequests.find((request) => request.state === "merged") ??
    followedRequests.find((request) => request.state === "opened")
  );
};

const isMergeCommit = (title: string) => /^Merge branch /.test(title);

const sameSha = (commit: string, sha?: string) =>
  !!sha && sha.length >= 7 && (commit === sha || commit.startsWith(sha) || sha.startsWith(commit));

/**
 * Whether the latest merge into the branch passed, read the way the commits table reads it:
 * the pipelines of the merge commit. GitLab often leaves the merge request's own pipeline empty.
 */
export const mergeStandingOf = (
  request: LatestMergeRequest | undefined,
  commits: readonly BranchCommit[],
): MergeStanding => {
  const matched = request
    ? commits.find((commit) => sameSha(commit.id, request.mergeCommitSha) || sameSha(commit.id, request.sha))
    : undefined;
  const merge = commits.find((commit) => isMergeCommit(commit.title));
  const withRuns = (commit?: BranchCommit) => (commit && commit.runs.length > 0 ? commit : undefined);
  // The merge request's own pipeline is often empty. The commits table already has the merge's pipelines.
  const commit = withRuns(matched) ?? withRuns(merge) ?? matched ?? merge;
  const status =
    (commit === matched ? request?.pipeline : undefined) ??
    (commit && commit.runs.length > 0 ? overallStatusOf(commit.runs) : undefined);
  const detail = commit === matched && request ? `!${request.iid} · ${request.title}` : commit?.title;

  if (!status) {
    return { text: commit ? "No pipeline" : "No merge", color: "textMuted", detail, failed: false };
  }

  const failed = status.color === "critical" || status.color === "warning";

  return {
    text:
      status.color === "success"
        ? "Passed"
        : status.color === "critical"
          ? status.label === "Timed out"
            ? "Timed out"
            : "Failed"
          : status.label,
    color: status.color === "grey60" ? "textMuted" : status.color,
    detail,
    projectUrl: failed ? request?.projectUrl ?? undefined : undefined,
    failed,
  };
};
