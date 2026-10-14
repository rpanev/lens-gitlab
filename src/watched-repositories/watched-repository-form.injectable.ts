import { getInjectable2 } from "@k8slens/injectable";
import { action, computed, observable } from "mobx";
import { gitProjectOfUrl } from "../deployments/git-url";
import { followedLabelOf, hostOf, isSameWatch, type WatchedRepository } from "./watched-repository";
import { watchedRepositoriesStoreInjectable } from "./watched-repositories-store.injectable";
import {
  defaultBranch,
  defaultHost,
  defaultIntervalMinutes,
  watchOfFields,
  watchProblemOf,
} from "./watch-input";

export type Track = NonNullable<WatchedRepository["track"]>;
export type Notify = NonNullable<WatchedRepository["notify"]>;

export const watchedRepositoryFormInjectable = getInjectable2({
  id: "lens-gitlab-watched-repository-form",

  instantiate: (di) => {
    const storeOf = di.inject(watchedRepositoriesStoreInjectable);

    return (clusterId: string) => {
      const store = storeOf(clusterId);

      const host = observable.box(defaultHost);
      const repository = observable.box("");
      const track = observable.box<Track>("branch");
      const branch = observable.box(defaultBranch);
      const includePrereleases = observable.box(true);
      const tagPattern = observable.box("");
      const intervalMinutes = observable.box(defaultIntervalMinutes);
      const notify = observable.box<Notify>("all");
      const editing = observable.box<WatchedRepository | undefined>(undefined, { deep: false });

      const draft = computed((): WatchedRepository =>
        watchOfFields({
          host: host.get(),
          repository: repository.get(),
          track: track.get(),
          branch: branch.get(),
          includePrereleases: includePrereleases.get(),
          tagPattern: tagPattern.get(),
          intervalMinutes: intervalMinutes.get(),
          notify: notify.get(),
        }),
      );

      const error = computed(() => {
        const watch = draft.get();
        const previous = editing.get();

        if (watch.repository === "") return undefined;

        return (
          watchProblemOf(watch) ??
          (!(previous && isSameWatch(previous, watch)) && store.has(watch)
            ? `${watch.repository} ${followedLabelOf(watch)} is already watched.`
            : undefined)
        );
      });

      const reset = action(() => {
        host.set(defaultHost);
        repository.set("");
        track.set("branch");
        branch.set(defaultBranch);
        includePrereleases.set(true);
        tagPattern.set("");
        intervalMinutes.set(defaultIntervalMinutes);
        notify.set("all");
        editing.set(undefined);
      });

      const form = {
        host,
        repository,
        track,
        branch,
        includePrereleases,
        tagPattern,
        intervalMinutes,
        notify,

        get isEditing() {
          return editing.get() !== undefined;
        },

        get error() {
          return error.get();
        },

        get canSubmit() {
          return draft.get().repository !== "" && error.get() === undefined;
        },

        /** A pasted project URL is split into the host and the path; a plain path is kept as typed. */
        setProject: action((value: string) => {
          const trimmed = value.trim();
          const parsed = /^(?:https?:\/\/|ssh:\/\/|git@)/i.test(trimmed) ? gitProjectOfUrl(trimmed) : undefined;

          if (parsed) {
            host.set(parsed.host);
            repository.set(parsed.project);
          } else {
            repository.set(value);
          }
        }),

        edit: action((watch: WatchedRepository) => {
          host.set(hostOf(watch));
          repository.set(watch.repository);
          track.set(watch.track ?? "branch");
          branch.set(watch.branch || defaultBranch);
          includePrereleases.set(watch.includePrereleases ?? true);
          tagPattern.set(watch.tagPattern ?? "");
          intervalMinutes.set(watch.intervalMinutes);
          notify.set(watch.notify ?? "all");
          editing.set(watch);
        }),

        cancel: reset,

        submit: async () => {
          if (!form.canSubmit) return;

          const previous = editing.get();

          await (previous ? store.replace(previous, draft.get()) : store.add(draft.get()));
          reset();
        },
      };

      return form;
    };
  },
});
