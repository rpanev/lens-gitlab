import { getInjectable2 } from "@k8slens/injectable";
import { observable, runInAction } from "mobx";
import { watchOfKey } from "../watched-repositories/watched-repository";
import { type GlabProblem, glabProblemOf } from "./glab-problems";
import { trackSourcesInjectable } from "./track-sources.injectable";
import type { LatestMergeRequest } from "./latest-merge-request";
import type { Version, VersionRuns } from "./version";

/** How often the branch is checked while something is moving: a run unfinished, or a deployment under way. */
export const liveCheckSeconds = 15;
/** How often the newest version is checked for while nothing is moving. */
const idleHeadCheckSeconds = 60;
/** A version this young with no runs yet is expected to start some. */
const awaitingRunsMinutes = 10;
/** How often a version GitLab said has no runs is asked again, between full checks: the answer may have been wrong. */
const noRunsRecheckMinutes = 5;

export type TrackActivityState =
  | { readonly status: "loading" }
  | {
      readonly status: "loaded";
      /** The latest versions, newest first. */
      readonly versions: readonly Version[];
      /** The most recent of them, with their runs. */
      readonly recent: readonly VersionRuns[];
      /** The latest merge request into the branch, when the watch follows one. */
      readonly mergeRequest?: LatestMergeRequest;
      readonly checkedAt: Date;
      /** Live while something is moving, so it is checked every {@link liveCheckSeconds}. */
      readonly mode: "live" | "idle";
      /** Why the last check did not go through, while what was had before stands. */
      readonly warning?: GlabProblem;
    }
  | { readonly status: "failed"; readonly problem: GlabProblem };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isUnfinished = ({ version, runs }: VersionRuns, now: number) =>
  runs.some((run) => run.status !== "completed") ||
  (runs.length === 0 && now - new Date(version.at).getTime() < awaitingRunsMinutes * 60_000);

/**
 * The latest versions of a watch and their runs, for as long as something watches them. Checked
 * often while runs are unfinished or a watcher says a deployment is under way, and rarely otherwise:
 * then only the newest version is asked for, which is what tells a new one has landed.
 */
export const trackActivityInjectable = getInjectable2({
  id: "lens-gitlab-track-activity",

  instantiate: (di) => {
    const sourceOf = di.inject(trackSourcesInjectable)();

    const open = (watchKey: string) => {
      const watch = watchOfKey(watchKey);
      const { intervalMinutes } = watch;
      const source = sourceOf(watch);
      const state = observable.box<TrackActivityState>({ status: "loading" }, { deep: false });
      const busyWatchers = new Set<() => boolean>();
      let watchers = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let checking: Promise<void> | undefined;
      let lastFullCheck = 0;
      let lastNoRunsCheck = 0;

      const loaded = () => {
        const current = state.get();

        return current.status === "loaded" ? current : undefined;
      };

      const isLive = (recent: readonly VersionRuns[]) => {
        const now = Date.now();

        return recent.some((each) => isUnfinished(each, now)) || [...busyWatchers].some((isBusy) => isBusy());
      };

      const mergeRequestOf = () => (source.latestMergeRequest ? source.latestMergeRequest() : undefined);

      const set = (
        recent: readonly VersionRuns[],
        versions: readonly Version[],
        warning?: GlabProblem,
        mergeRequest?: LatestMergeRequest,
      ) =>
        runInAction(() =>
          state.set({
            status: "loaded",
            versions,
            recent,
            mergeRequest,
            checkedAt: new Date(),
            mode: isLive(recent) ? "live" : "idle",
            warning,
          }),
        );

      const checkAll = async () => {
        const [{ versions, recent }, mergeRequest] = await Promise.all([source.all(), mergeRequestOf()]);

        lastFullCheck = lastNoRunsCheck = Date.now();
        set(recent, versions, undefined, mergeRequest);
      };

      /** Asks again only for what can have changed since the last check. */
      const checkChanges = async () => {
        const previous = loaded();

        if (!previous || Date.now() - lastFullCheck >= intervalMinutes * 60_000) return checkAll();
        if ((await source.headOf()) !== previous.versions[0]?.id) return checkAll();

        const now = Date.now();
        const noRunsDue = now - lastNoRunsCheck >= noRunsRecheckMinutes * 60_000;
        const hasNoRuns = (each: VersionRuns) => each.runs.length === 0 && each.otherRuns.length === 0;
        const [recent, mergeRequest] = await Promise.all([
          Promise.all(
            previous.recent.map((each) =>
              isUnfinished(each, now) || (noRunsDue && hasNoRuns(each)) ? source.runsOf(each.version) : each,
            ),
          ),
          mergeRequestOf(),
        ]);

        if (noRunsDue) lastNoRunsCheck = now;

        set(recent, previous.versions, undefined, mergeRequest);
      };

      const problemNow = () => {
        const current = state.get();

        return current.status === "failed"
          ? current.problem
          : current.status === "loaded"
            ? current.warning
            : undefined;
      };

      const nextCheckInSeconds = () => {
        if (problemNow()?.cause === "rate-limit") return intervalMinutes * 60;

        return loaded()?.mode === "live" ? liveCheckSeconds : idleHeadCheckSeconds;
      };

      // A problem waiting for the user, such as glab signed out, would only fail again: checks stop until the
      // user checks again, or something new follows the watch, such as its dashboard being opened.
      const schedule = () => {
        clearTimeout(timer);
        if (watchers > 0 && !problemNow()?.waitsForUser)
          timer = setTimeout(() => void check(checkChanges), nextCheckInSeconds() * 1000);
      };

      const check = (how: () => Promise<void>) =>
        (checking ??= how()
          .catch((error) => {
            const previous = loaded();
            const problem = glabProblemOf(messageOf(error), watch.repository);

            runInAction(() => state.set(previous ? { ...previous, warning: problem } : { status: "failed", problem }));
          })
          .finally(() => {
            checking = undefined;
            schedule();
          }));

      return {
        get state() {
          return state.get();
        },

        // A quick check under way would answer for less than asked, so a full one follows it.
        refresh: async () => {
          await checking;

          return check(checkAll);
        },

        /**
         * Starts checking; the function it returns stops. `isBusy` keeps the checks live while it says
         * something is under way that new runs or commits may follow, such as a deployment.
         */
        watch: (isBusy?: () => boolean) => {
          if (isBusy) busyWatchers.add(isBusy);
          if (watchers++ === 0 || problemNow()?.waitsForUser) void check(loaded() ? checkChanges : checkAll);

          return () => {
            if (isBusy) busyWatchers.delete(isBusy);
            if (--watchers === 0) clearTimeout(timer);
          };
        },
      };
    };

    const byWatch = new Map<string, ReturnType<typeof open>>();

    // One poller per watch, so dev, stage and prod following the same project share its GitLab reads.
    return (watchKey: string) => {
      const kept = byWatch.get(watchKey);

      if (kept) return kept;

      const created = open(watchKey);

      byWatch.set(watchKey, created);

      return created;
    };
  },
});
