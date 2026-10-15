import { allClusterRecordsReactiveInjectionToken, type ClusterRecord } from "@k8slens/cluster-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import { action, computed, type IComputedValue, observable } from "mobx";

/** Every cluster Lens knows, kept current, blank until Lens has answered. */
export const clusterRecordsInjectable = getInjectable2({
  id: "lens-gitlab-cluster-records",
  consumptions: [allClusterRecordsReactiveInjectionToken],

  instantiate: (di) => {
    const clusterRecords = di.inject(allClusterRecordsReactiveInjectionToken);
    const held = observable.box<IComputedValue<ClusterRecord[]> | undefined>(undefined, { deep: false });

    void clusterRecords().then(action((loaded) => held.set(loaded)));

    const records = computed(() => held.get()?.get() ?? []);

    return () => records;
  },
});
