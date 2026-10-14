import { getInjectable2 } from "@k8slens/injectable";
import { action, type IObservableArray, observable } from "mobx";
import { isSameWatch, type WatchedRepository } from "./watched-repository";
import { watchedRepositoriesBunch } from "./watched-repositories.injectable";

export const watchedRepositoriesStoreInjectable = getInjectable2({
  id: "lens-gitlab-watched-repositories-store",

  instantiate: (di) => {
    const getPersistedRepositories = di.inject(watchedRepositoriesBunch.persistable);

    return (clusterId: string) => {
      const getWatchedRepositories = () => getPersistedRepositories(clusterId);
      const loaded = observable.box<IObservableArray<WatchedRepository> | undefined>(undefined, { deep: false });

      void getWatchedRepositories().then(action((watched) => loaded.set(watched)));

      const store = {
        /** Undefined until the persisted list has been read. */
        get all(): readonly WatchedRepository[] | undefined {
          return loaded.get();
        },

        has: (watch: WatchedRepository) => !!loaded.get()?.some((each) => isSameWatch(each, watch)),

        add: action(async (watch: WatchedRepository) => {
          (await getWatchedRepositories()).push(watch);
        }),

        // The persisted array is shallow, so an edit replaces the item rather than mutating it.
        replace: action(async (previous: WatchedRepository, next: WatchedRepository) => {
          const watched = await getWatchedRepositories();
          const index = watched.findIndex((each) => isSameWatch(each, previous));

          // Removed while it was being edited: saving it keeps what was saved, rather than nothing.
          if (index === -1) watched.push(next);
          else watched.splice(index, 1, next);
        }),

        remove: action(async (watch: WatchedRepository) => {
          const watched = await getWatchedRepositories();

          watched.replace(watched.filter((each) => !isSameWatch(each, watch)));
        }),
      };

      return store;
    };
  },
});
