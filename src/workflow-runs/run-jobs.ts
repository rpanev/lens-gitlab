import { z } from "zod";

const stepSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullish(),
  number: z.number().nullish(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
});

export type RunStep = z.infer<typeof stepSchema>;

export const runJobSchema = z.object({
  databaseId: z.number(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullish(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
  url: z.string(),
  steps: z.array(stepSchema).nullish(),
});

export type RunJob = z.infer<typeof runJobSchema>;

export const runJobsSchema = z.object({ jobs: z.array(runJobSchema) });

const seconds = (from?: string | null, to?: string | null, now = Date.now()) =>
  from ? Math.max(0, ((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 1000) : undefined;

/** How long a job took, or has been running: "45s", "2m 10s", "1h 3m". */
export const durationOf = ({ startedAt, completedAt }: Pick<RunJob, "startedAt" | "completedAt">, now = Date.now()) => {
  const total = seconds(startedAt, completedAt, now);

  if (total === undefined) return undefined;

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = Math.floor(total % 60);

  if (hours > 0) return `${hours}h ${minutes}m`;

  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
};

/** The step a job failed in, when it failed in one. */
export const failedStepOf = ({ steps }: Pick<RunJob, "steps">) =>
  steps?.find((step) => step.conclusion === "failure")?.name;

export const isFinished = (job: Pick<RunJob, "status">) => job.status === "completed";

export const isFailed = (job: Pick<RunJob, "status" | "conclusion">) =>
  isFinished(job) && (job.conclusion === "failure" || job.conclusion === "timed_out");
