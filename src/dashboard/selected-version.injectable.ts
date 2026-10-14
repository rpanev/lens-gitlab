import { getInjectable2 } from "@k8slens/injectable";
import { action, observable } from "mobx";

/** A version of one watch: what the details panel shows. */
export interface VersionSelection {
  readonly watchKey: string;
  readonly versionId: string;
}

/** The version whose details panel is open on one cluster's dashboard, if any. */
export const selectedVersionInjectable = getInjectable2({
  id: "lens-gitlab-selected-version",

  instantiate: () => (_clusterId: string) => {
    const selected = observable.box<VersionSelection | undefined>(undefined, { deep: false });

    return {
      get current() {
        return selected.get();
      },

      select: action((selection: VersionSelection) => selected.set(selection)),
      close: action(() => selected.set(undefined)),
    };
  },
});
