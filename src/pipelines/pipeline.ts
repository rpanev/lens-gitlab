// Zod checks GitLab's JSON before the UI reads it. This Lens build serves 3.25.76, so the range stays on that.
import { z } from "zod";
import { urlOnHost } from "./browser-url";

export const pipelineSchema = z.object({
  databaseId: z.number(),
  name: z.string(),
  headBranch: z.string(),
  /** The commit it ran on. */
  headSha: z.string(),
  /** What started it: "push", "schedule", "merge_request_event"… */
  event: z.string(),
  status: z.string(),
  conclusion: z.string(),
  url: z.string().optional(),
  /** When the pipeline finished, for the CI stage of a lead time. */
  finishedAt: z.string().optional(),
});

export type Pipeline = z.infer<typeof pipelineSchema>;

/**
 * Pipelines recorded against a commit that the commit did not start: a merge request's pipeline, a
 * security scan, a DAST run. A scheduled pipeline does build the commit the branch is at.
 */
const recordedApart = new Set([
  "merge_request_event",
  "external_pull_request_event",
  "ondemand_dast_scan",
  "ondemand_dast_validation",
  "security_orchestration_policy",
]);

/** Whether a version started the pipeline. */
export const isStartedByVersion = (run: Pick<Pipeline, "event">) => !recordedApart.has(run.event);

/** GitLab's one status, as the queued / in progress / completed conclusion the rest of the UI reads. */
export const runStateOf = (gitlabStatus: string): { status: string; conclusion: string } => {
  switch (gitlabStatus) {
    case "running":
    case "canceling":
      return { status: "in_progress", conclusion: "" };
    case "created":
    case "pending":
    case "preparing":
    case "waiting_for_resource":
    case "scheduled":
      return { status: "queued", conclusion: "" };
    case "success":
      return { status: "completed", conclusion: "success" };
    case "failed":
      return { status: "completed", conclusion: "failure" };
    case "canceled":
      return { status: "completed", conclusion: "cancelled" };
    case "manual":
      return { status: "manual", conclusion: "" };
    default:
      return { status: "completed", conclusion: "skipped" };
  }
};

/** What names a pipeline when GitLab did not give it one. */
export const pipelineNameOf = (source: string, name?: string | null) => {
  const named = name?.trim();

  if (named) return named;

  switch (source) {
    case "schedule":
      return "Schedule";
    case "web":
      return "Manual";
    case "api":
      return "API";
    case "trigger":
      return "Trigger";
    case "parent_pipeline":
      return "Child pipeline";
    case "pipeline":
      return "Downstream";
    case "merge_request_event":
      return "Merge request";
    default:
      return "Pipeline";
  }
};

export interface GitlabPipeline {
  readonly id: number;
  readonly sha: string;
  readonly ref: string;
  readonly status: string;
  readonly source: string;
  readonly name?: string | null;
  readonly web_url?: string | null;
  readonly finished_at?: string | null;
}

export const toPipeline = (pipeline: GitlabPipeline): Pipeline => {
  const { status, conclusion } = runStateOf(pipeline.status);

  return {
    databaseId: pipeline.id,
    name: pipelineNameOf(pipeline.source, pipeline.name),
    headBranch: pipeline.ref,
    headSha: pipeline.sha,
    event: pipeline.source,
    status,
    conclusion,
    url: pipeline.web_url ?? undefined,
    finishedAt: pipeline.finished_at ?? undefined,
  };
};

export const runUrlOf = (host: string, project: string, run: Pick<Pipeline, "databaseId" | "url">) =>
  urlOnHost(run.url, host) ?? `https://${host}/${project}/-/pipelines/${run.databaseId}`;

/**
 * The pipelines of a commit: those asked for by its id, with those of it among the project's latest
 * pipelines. Newest first.
 */
export const runsOfCommitWith = (
  sha: string,
  askedByCommit: readonly Pipeline[],
  latest: readonly Pipeline[],
): Pipeline[] =>
  [...askedByCommit, ...latest.filter((run) => run.headSha === sha)]
    .filter((run, index, runs) => runs.findIndex((each) => each.databaseId === run.databaseId) === index)
    .sort((a, b) => b.databaseId - a.databaseId);
