import { getAskAiFunctionInjectableBunch, getAskAiFunctionKind } from "@k8slens/ask-ai-contracts";
import { watchOnClusterInjectable } from "../dashboard/watch-on-cluster.injectable";
import { watchKeyOf } from "../watched-repositories/watched-repository";
import { watchedRepositoriesStoreInjectable } from "../watched-repositories/watched-repositories-store.injectable";
import { projectPipelinesReadingOf, watchedMatching } from "./reading";

export const projectPipelinesFunctionKind = getAskAiFunctionKind<
  { clusterId: string; project: string; host?: string; follows?: string },
  { projects: ReturnType<typeof projectPipelinesReadingOf>[] }
>()("project-pipelines");

export default getAskAiFunctionInjectableBunch({
  kind: projectPipelinesFunctionKind,
  offeredIn: "every-conversation",
  description:
    "Reports the latest commits or releases of one GitLab project the GitLab extension watches on a cluster, with each pipeline's status and whether the cluster runs that version: image tag, Flux image automation, Helm chart, Flux Kustomization or Argo CD Application. Use it when the user asks about pipelines, commits or releases of a named project. For how the cluster stands overall and the list of projects, use cluster-status instead. It does not change what is watched.",
  inputDescription:
    '`clusterId` (string): the Lens cluster id of the cluster the conversation is about. `project` (string): the project as group/project. `host` (string, optional): the GitLab host; gitlab.com when omitted. `follows` (string, optional): which watch, such as "main", when that project is watched more than once.',
  outputDescription:
    '`projects` (array): one entry per matching watch. Each has `host` (string), `project` (string), `follows` (string), `gitlab` ("loaded", "checking" or "unreachable"), `problem` (string or null: why GitLab could not be read), `cluster` ("loaded", "checking" or "unreachable"), `clusterProblem` (string or null), `versions` (array, empty while GitLab is not loaded). A version has `label`, `title`, `at` (ISO 8601), `url`, `prerelease` (boolean), `pipelineSummary` (string), `pipelineStatus` (string or null, such as "Failed"), `pipelines` (array of `name`, `status`, `url`), `services` (array of `name` and `status`: empty while the cluster is still being read, which is not "nothing runs it"), `syncs` (array of `kind` "Kustomization" or "Application", `name`, `status`).',
  invoke: {
    instantiate: (di) => {
      const storeOf = di.inject(watchedRepositoriesStoreInjectable);
      const watchOnCluster = di.inject(watchOnClusterInjectable);

      return () =>
        async ({ clusterId, project, host, follows }) => {
          const watched = storeOf(clusterId).all;

          if (!watched) throw new Error("The watched projects of this cluster are still being read. Try again in a moment.");

          const matched = watchedMatching(watched, project, host, follows);

          if ("error" in matched) throw new Error(matched.error);

          const projects = [];

          for (const watch of matched.watches) {
            const state = watchOnCluster(clusterId, watchKeyOf(watch));

            // A check still running is reported as checking. Starting one does not wait for glab:
            // an Ask AI function stays quick, and a failure that waits for the user is not retried here.
            if (state.activity.status === "loading") void state.refresh();

            projects.push(projectPipelinesReadingOf(watch, state.activity, state.cluster, state.rows));
          }

          return { projects };
        };
    },
  },
});
