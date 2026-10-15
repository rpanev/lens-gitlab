import { getPersistableArrayInjectableBunch } from "@k8slens/persistable-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import { action, type IObservableArray, observable } from "mobx";
import { type DoraDeploy, rememberDeploys } from "./dora";

// One list per cluster, kept across restarts the way watches are.
export const doraDeploysBunch = getPersistableArrayInjectableBunch<DoraDeploy, [clusterId: string]>()({
  id: "dora-deploys",
});

const same = (left: readonly DoraDeploy[], right: readonly DoraDeploy[]) => JSON.stringify(left) === JSON.stringify(right);

/** The deploys remembered for a cluster, and recording new observations into them. */
export const doraStoreInjectable = getInjectable2({
  id: "lens-gitlab-dora-store",

  instantiate: (di) => {
    const getPersisted = di.inject(doraDeploysBunch.persistable);
    const open = (clusterId: string) => {
      const loaded = observable.box<IObservableArray<DoraDeploy> | undefined>(undefined, { deep: false });

      void getPersisted(clusterId).then(action((deploys) => loaded.set(deploys)));

      return {
        get all() {
          return loaded.get();
        },

        record: async (incoming: readonly DoraDeploy[]) => {
          const stored = await getPersisted(clusterId);
          const next = rememberDeploys(stored, incoming, Date.now());

          if (same(stored, next)) return;

          stored.replace(next);
        },
      };
    };

    const byCluster = new Map<string, ReturnType<typeof open>>();

    return (clusterId: string) => {
      const kept = byCluster.get(clusterId);

      if (kept) return kept;

      const created = open(clusterId);

      byCluster.set(clusterId, created);

      return created;
    };
  },
});
