import { z } from "zod";
import { urlOnHost } from "./browser-url";

const commitSchema = z.object({
  id: z.string(),
  short_id: z.string().nullish(),
  title: z.string(),
  web_url: z.string().nullish(),
});

const mergeRequestSchema = z.object({
  iid: z.number(),
  title: z.string(),
  sha: z.string().nullish(),
  merge_commit_sha: z.string().nullish(),
  squash_commit_sha: z.string().nullish(),
  web_url: z.string().nullish(),
});

export const compareSchema = z.object({
  commits: z.array(commitSchema).nullish(),
});

export const mergedRequestsSchema = z.array(mergeRequestSchema);

export interface AheadCommit {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly url?: string;
}

export interface AheadMergeRequest {
  readonly iid: number;
  readonly title: string;
  readonly url?: string;
}

/** Commits on `to` that are not in `from`: what deploying the latest brings in. */
export const comparePathOf = (project: string, from: string, to: string) =>
  `projects/${encodeURIComponent(project)}/repository/compare?${new URLSearchParams({ from, to })}`;

/** Merge requests already merged into the branch, newest first, to match against that compare. */
export const mergedRequestsPathOf = (project: string, targetBranch: string) =>
  `projects/${encodeURIComponent(project)}/merge_requests?${new URLSearchParams({
    state: "merged",
    target_branch: targetBranch,
    order_by: "updated_at",
    sort: "desc",
    per_page: "50",
  })}`;

export const compareUrlOf = (host: string, project: string, from: string, to: string) =>
  `https://${host}/${project}/-/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`;

const sameCommit = (sha: string | null | undefined, commits: readonly { id: string }[]) => {
  if (!sha) return false;

  const id = sha.toLowerCase();

  return commits.some((commit) => {
    const each = commit.id.toLowerCase();

    return each === id || each.startsWith(id) || id.startsWith(each);
  });
};

/** The commits between two versions, and the merge requests whose commit is one of them. */
export const aheadOf = (
  host: string,
  project: string,
  compared: z.infer<typeof compareSchema>,
  merged: z.infer<typeof mergedRequestsSchema>,
): { readonly commits: readonly AheadCommit[]; readonly mergeRequests: readonly AheadMergeRequest[] } => {
  const commits = compared.commits ?? [];
  const listed = commits.map(
    (commit): AheadCommit => ({
      id: commit.id,
      label: commit.short_id ?? commit.id.slice(0, 7),
      title: commit.title,
      url: urlOnHost(commit.web_url, host) ?? `https://${host}/${project}/-/commit/${commit.id}`,
    }),
  );

  return {
    commits: listed,
    mergeRequests: merged.flatMap((request): AheadMergeRequest[] => {
      const landed =
        sameCommit(request.merge_commit_sha, commits) ||
        sameCommit(request.squash_commit_sha, commits) ||
        sameCommit(request.sha, commits);

      if (!landed) return [];

      return [
        {
          iid: request.iid,
          title: request.title,
          url: urlOnHost(request.web_url, host) ?? `https://${host}/${project}/-/merge_requests/${request.iid}`,
        },
      ];
    }),
  };
};

/**
 * From the oldest version still running to the latest one, when something is behind. The same version
 * both ends has nothing to bring in.
 */
export const rangeBehindOf = (
  running: readonly { id: string; label: string; behind: number }[],
  newest?: { id: string; label: string },
) => {
  const behind = running.filter((place) => place.behind > 0);

  if (!newest || behind.length === 0) return undefined;

  const oldest = behind.reduce((left, right) => (right.behind > left.behind ? right : left));

  if (oldest.id === newest.id) return undefined;

  return { from: oldest.id, to: newest.id, fromLabel: oldest.label, toLabel: newest.label };
};
