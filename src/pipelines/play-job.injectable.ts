import { getInjectable2 } from "@k8slens/injectable";
import { openModalInjectionToken } from "@k8slens/modal-contracts";
import { showErrorNotificationInjectionToken } from "@k8slens/notifications-contracts";
import { glabProblemOf } from "./glab-problems";
import { glabInjectable } from "./glab.injectable";
import { playModalKind } from "./play-modal.injectable";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Plays one manual job, once the user confirmed, and answers whether it did. */
export const playJobPathOf = (project: string, jobId: number) =>
  `projects/${encodeURIComponent(project)}/jobs/${jobId}/play`;

export const playManualJobInjectable = getInjectable2({
  id: "lens-gitlab-play-manual-job",
  consumptions: [openModalInjectionToken, showErrorNotificationInjectionToken],

  instantiate: (di) => {
    const glab = di.inject(glabInjectable)();
    const confirm = di.inject(openModalInjectionToken.for(playModalKind).for(di.scopeIds))();
    const showErrorNotification = di.inject(showErrorNotificationInjectionToken)();

    return () =>
      async (host: string, project: string, jobId: number, jobName: string, version: string): Promise<boolean> => {
        if (!(await confirm(jobName, version))) return false;

        try {
          await glab(host, playJobPathOf(project, jobId), "POST");

          return true;
        } catch (error) {
          const problem = glabProblemOf(messageOf(error), project);

          showErrorNotification(`Could not play ${jobName}: ${problem.title} ${problem.fix}`);

          return false;
        }
      };
  },
});
