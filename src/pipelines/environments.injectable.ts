import { getInjectable2 } from "@k8slens/injectable";
import { observable, runInAction } from "mobx";
import { type GlabProblem, glabProblemOf } from "./glab-problems";
import { glabInjectable, readGlabJson } from "./glab.injectable";
import { deploymentsPathOf, deploymentsSchema, type GitlabDeployment, latestDeploymentsOf } from "./environments";

export type EnvironmentsState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly deployments: readonly GitlabDeployment[] }
  | { readonly status: "failed"; readonly problem: GlabProblem };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The project's successful deployments, one reading shared by every cluster that watches it. */
export const gitlabEnvironmentsInjectable = getInjectable2({
  id: "lens-gitlab-environments",

  instantiate: (di) => {
    const glab = di.inject(glabInjectable)();

    const open = (host: string, project: string) => {
      const state = observable.box<EnvironmentsState>({ status: "loading" }, { deep: false });
      let loading: Promise<void> | undefined;

      const load = () =>
        (loading ??= fetchDeployments().finally(() => {
          loading = undefined;
        }));

      const fetchDeployments = async () => {
        try {
          const deployments = latestDeploymentsOf(
            deploymentsSchema.parse(await readGlabJson(glab, host, deploymentsPathOf(project))),
          );

          runInAction(() => state.set({ status: "loaded", deployments }));
        } catch (error) {
          runInAction(() => state.set({ status: "failed", problem: glabProblemOf(messageOf(error), project) }));
        }
      };

      return {
        get state() {
          return state.get();
        },

        load,
      };
    };

    const byProject = new Map<string, ReturnType<typeof open>>();

    return (host: string, project: string) => {
      const key = `${host}\n${project}`;
      const kept = byProject.get(key);

      if (kept) return kept;

      const created = open(host, project);

      byProject.set(key, created);

      return created;
    };
  },
});
