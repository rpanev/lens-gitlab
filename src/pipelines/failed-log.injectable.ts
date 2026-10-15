import { getInjectable2 } from "@k8slens/injectable";
import { observable, runInAction } from "mobx";
import { failedLogLinesOf, type LogLine } from "./failed-log";
import { type GlabProblem, glabProblemOf } from "./glab-problems";
import { glabInjectable } from "./glab.injectable";

export type FailedLogState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly lines: readonly LogLine[] }
  | { readonly status: "failed"; readonly problem: GlabProblem };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const projectPath = (project: string) => encodeURIComponent(project);

/** The end of a failed job's trace, asked for once when first shown: a finished job's trace does not change. */
export const failedLogInjectable = getInjectable2({
  id: "lens-gitlab-failed-log",

  instantiate: (di) => {
    const glab = di.inject(glabInjectable)();

    return (host: string, project: string, jobId: number) => {
      const state = observable.box<FailedLogState>({ status: "loading" }, { deep: false });
      let asked: Promise<void> | undefined;

      const load = async () => {
        try {
          const output = await glab(host, `projects/${projectPath(project)}/jobs/${jobId}/trace`);

          runInAction(() => state.set({ status: "loaded", lines: failedLogLinesOf(output) }));
        } catch (error) {
          asked = undefined;
          runInAction(() => state.set({ status: "failed", problem: glabProblemOf(messageOf(error), project) }));
        }
      };

      return {
        get state() {
          return state.get();
        },

        /** Asks for the trace, unless it was asked for already. */
        load: () => (asked ??= load()),
      };
    };
  },
});
