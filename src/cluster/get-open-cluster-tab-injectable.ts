import { getInjectable2 } from "@k8slens/injectable";
import { mainViewTabHostKind } from "@k8slens/main-view-contracts";
import {
  focusTabInjectionToken,
  openTabInjectionToken,
  type TabKind,
  tabIsOpenInjectionToken,
} from "@k8slens/tab-contracts";

/** An opener for a main view tab kind that has one tab per cluster, its id being the cluster's id. */
export const getOpenClusterTabInjectable = (id: string, kind: TabKind<void>) =>
  getInjectable2({
    id,
    consumptions: [openTabInjectionToken, focusTabInjectionToken, tabIsOpenInjectionToken],

    instantiate: (di) => {
      const openTab = di.inject(openTabInjectionToken.for(mainViewTabHostKind).for(kind).for(di.scopeIds))();
      const focusTab = di.inject(focusTabInjectionToken.for(mainViewTabHostKind).for(kind).for(di.scopeIds))();
      const isOpen = di.inject(tabIsOpenInjectionToken.for(mainViewTabHostKind).for(kind).for(di.scopeIds))();

      return () => async (clusterId: string) => {
        const tabId = clusterId;

        await ((await isOpen({ tabId })) ? focusTab({ tabId }) : openTab({ tabId }));
      };
    },
  });
