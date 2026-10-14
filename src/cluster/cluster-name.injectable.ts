import { clusterNameReactiveInjectionToken } from "@k8slens/cluster-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import { action, computed, type IComputedValue, observable } from "mobx";

export const clusterNameInjectable = getInjectable2({
  id: "lens-gitlab-cluster-name",
  consumptions: [clusterNameReactiveInjectionToken],

  instantiate: (di) => {
    const clusterNameReactive = di.inject(clusterNameReactiveInjectionToken);

    return (clusterId: string) => {
      const name = observable.box<IComputedValue<string> | undefined>(undefined, { deep: false });

      void clusterNameReactive(clusterId).then(action((loaded) => name.set(loaded)));

      // Blank until Lens has answered.
      return computed(() => name.get()?.get() ?? "");
    };
  },
});
