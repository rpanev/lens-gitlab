import { getInjectable2 } from "@k8slens/injectable";
import { openModalInjectionToken } from "@k8slens/modal-contracts";
import { showErrorNotificationInjectionToken } from "@k8slens/notifications-contracts";
import { glabProblemOf } from "./glab-problems";
import { glabInjectable } from "./glab.injectable";
import { rerunModalKind } from "./rerun-modal.injectable";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Re-runs the failed jobs of a pipeline, once the user confirmed, and answers whether it did; what
 * shows the pipeline checks again then, so the new attempt shows up.
 */
export const rerunFailedJobsInjectable = getInjectable2({
  id: "lens-gitlab-rerun-failed-jobs",
  consumptions: [openModalInjectionToken, showErrorNotificationInjectionToken],

  instantiate: (di) => {
    const glab = di.inject(glabInjectable)();
    const confirm = di.inject(openModalInjectionToken.for(rerunModalKind).for(di.scopeIds))();
    const showErrorNotification = di.inject(showErrorNotificationInjectionToken)();

    return () =>
      async (host: string, project: string, pipelineId: number, pipelineName: string, version: string): Promise<boolean> => {
        if (!(await confirm(pipelineName, version))) return false;

        try {
          await glab(host, `projects/${encodeURIComponent(project)}/pipelines/${pipelineId}/retry`, "POST");

          return true;
        } catch (error) {
          const problem = glabProblemOf(messageOf(error), project);

          showErrorNotification(`Could not re-run ${pipelineName}: ${problem.title} ${problem.fix}`);

          return false;
        }
      };
  },
});
