import { getInjectable2 } from "@k8slens/injectable";
import { observable, runInAction } from "mobx";
import { type GlabProblem, glabProblemOf } from "./glab-problems";
import { glabInjectable, readGlabJson } from "./glab.injectable";
import {
  type AheadCommit,
  type AheadMergeRequest,
  aheadOf,
  comparePathOf,
  compareSchema,
  compareUrlOf,
  mergedRequestsPathOf,
  mergedRequestsSchema,
} from "./compare";

export type CompareState =
  | { readonly status: "loading" }
  | {
      readonly status: "loaded";
      readonly commits: readonly AheadCommit[];
      readonly mergeRequests: readonly AheadMergeRequest[];
      readonly url: string;
    }
  | { readonly status: "failed"; readonly problem: GlabProblem };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What deploying the latest version brings in, asked again whenever the dashboard checks. */
export const compareAheadInjectable = getInjectable2({
  id: "lens-gitlab-compare-ahead",

  instantiate: (di) => {
    const glab = di.inject(glabInjectable)();

    const open = (host: string, project: string, from: string, to: string, targetBranch?: string) => {
      const state = observable.box<CompareState>({ status: "loading" }, { deep: false });
      let loading: Promise<void> | undefined;

      const load = () =>
        (loading ??= fetchCompare().finally(() => {
          loading = undefined;
        }));

      const fetchCompare = async () => {
        try {
          const [compared, merged] = await Promise.all([
            readGlabJson(glab, host, comparePathOf(project, from, to)),
            targetBranch
              ? readGlabJson(glab, host, mergedRequestsPathOf(project, targetBranch)).catch(() => [])
              : [],
          ]);
          const ahead = aheadOf(host, project, compareSchema.parse(compared), mergedRequestsSchema.parse(merged));

          runInAction(() =>
            state.set({ status: "loaded", ...ahead, url: compareUrlOf(host, project, from, to) }),
          );
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

    const byRange = new Map<string, ReturnType<typeof open>>();

    return (host: string, project: string, from: string, to: string, targetBranch?: string) => {
      const key = `${host}\n${project}\n${from}\n${to}\n${targetBranch ?? ""}`;
      const kept = byRange.get(key);

      if (kept) return kept;

      const created = open(host, project, from, to, targetBranch);

      byRange.set(key, created);

      return created;
    };
  },
});
