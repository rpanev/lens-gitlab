import { getInjectable2 } from "@k8slens/injectable";
import { observable, runInAction } from "mobx";
import { z } from "zod";
import { type GlabProblem, glabProblemOf } from "./glab-problems";
import { glabInjectable } from "./glab.injectable";
import { isFinished, type RunJob, type RunStep } from "./run-jobs";
import { liveCheckSeconds } from "./track-activity.injectable";
import { urlOnHost } from "./browser-url";
import { runStateOf } from "./pipeline";

export type RunJobsState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly jobs: readonly RunJob[] }
  | { readonly status: "failed"; readonly problem: GlabProblem };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const gitlabJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  stage: z.string().nullish(),
  status: z.string(),
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
  web_url: z.string().nullish(),
  failure_reason: z.string().nullish(),
});

const toJob = (host: string, project: string, job: z.infer<typeof gitlabJobSchema>): RunJob => {
  const { status, conclusion } = runStateOf(job.status);
  const failed = job.status === "failed" && job.failure_reason;
  const steps: RunStep[] | undefined = failed
    ? [
        {
          name: job.failure_reason!.replaceAll("_", " "),
          status: "completed",
          conclusion: "failure",
        },
      ]
    : undefined;

  return {
    databaseId: job.id,
    name: job.stage ? `${job.stage}: ${job.name}` : job.name,
    status,
    conclusion,
    startedAt: job.started_at,
    completedAt: job.finished_at,
    url: urlOnHost(job.web_url, host) ?? `https://${host}/${project}/-/jobs/${job.id}`,
    steps,
  };
};

/**
 * The jobs of one pipeline, asked for when first shown: once for a pipeline whose jobs have all finished,
 * and again at the live interval while some are still running and something shows them.
 */
export const runJobsInjectable = getInjectable2({
  id: "lens-gitlab-run-jobs",

  instantiate: (di) => {
    const glab = di.inject(glabInjectable)();

    return (host: string, project: string, pipelineId: number) => {
      const state = observable.box<RunJobsState>({ status: "loading" }, { deep: false });
      let watchers = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let loading: Promise<void> | undefined;
      let lastStatus: string | undefined;
      const id = encodeURIComponent(project);

      const finished = () => {
        const current = state.get();

        return current.status === "loaded" && current.jobs.every(isFinished);
      };

      const waitsForUser = () => {
        const current = state.get();

        return current.status === "failed" && current.problem.waitsForUser;
      };

      const schedule = () => {
        clearTimeout(timer);
        if (watchers > 0 && !finished() && !waitsForUser())
          timer = setTimeout(() => void load(), liveCheckSeconds * 1000);
      };

      const load = () =>
        (loading ??= fetchJobs().finally(() => {
          loading = undefined;
          schedule();
        }));

      const fetchJobs = async () => {
        try {
          const jobs = z
            .array(gitlabJobSchema)
            .parse(JSON.parse(await glab(host, `projects/${id}/pipelines/${pipelineId}/jobs?per_page=100`)));
          const bridges = z
            .array(gitlabJobSchema)
            .parse(
              JSON.parse(
                await glab(host, `projects/${id}/pipelines/${pipelineId}/bridges?per_page=100`).catch(() => "[]"),
              ),
            );
          const mapped = [...jobs, ...bridges]
            .map((job) => toJob(host, project, job))
            .filter((job, index, all) => all.findIndex((each) => each.databaseId === job.databaseId) === index)
            .sort((a, b) => a.databaseId - b.databaseId);

          runInAction(() => state.set({ status: "loaded", jobs: mapped }));
        } catch (error) {
          runInAction(() => state.set({ status: "failed", problem: glabProblemOf(messageOf(error), project) }));
        }
      };

      return {
        get state() {
          return state.get();
        },

        /** Asks again now, as after re-running the pipeline. */
        refresh: () => load(),

        /** Starts showing them, for the pipeline in the status given; the function it returns stops. */
        watch: (runStatus: string) => {
          const changed = lastStatus !== undefined && lastStatus !== runStatus;

          lastStatus = runStatus;
          watchers++;
          if (changed || (watchers === 1 && !finished())) void load();

          return () => {
            if (--watchers === 0) clearTimeout(timer);
          };
        },
      };
    };
  },
});
