import { clusterNavigatorItemKind } from "@k8slens/cluster-contracts";
import { NavigatorItemIcon, NavigatorItemLabel, NavigatorLeafIndicator } from "@k8slens/navigator-components";
import {
  getNavigatorItemKind,
  getNavigatorItemKindInjectableBunch2,
  type NavigatorItemProps,
} from "@k8slens/navigator-contracts";
import { computed } from "mobx";
import { openDashboardTabInjectable } from "../dashboard/open-dashboard-tab.injectable";
import { GitlabIcon } from "../gitlab-icon";

interface GitlabItem {
  readonly id: string;
  readonly name: string;
}

export const gitlabNavigatorItemKind = getNavigatorItemKind<GitlabItem, [clusterId: string]>()("gitlab");

const GitlabRow = ({ item }: NavigatorItemProps<GitlabItem, typeof clusterNavigatorItemKind>) => (
  <>
    <NavigatorLeafIndicator />
    <NavigatorItemIcon>
      <GitlabIcon $size="s" />
    </NavigatorItemIcon>
    <NavigatorItemLabel>{item.name}</NavigatorItemLabel>
  </>
);

export const gitlabNavigatorItemBunch = getNavigatorItemKindInjectableBunch2({
  kind: gitlabNavigatorItemKind,
  parentKind: clusterNavigatorItemKind,
  description: "The GitLabOps dashboard of a cluster.",

  items: {
    instantiate: () => async () => computed((): GitlabItem[] => [{ id: "gitlab", name: "GitLabOps" }]),
  },

  activate: {
    instantiate: (di) => {
      const openTab = di.inject(openDashboardTabInjectable)();

      return async (clusterId: string) => {
        await openTab(clusterId);
      };
    },
  },

  Component: GitlabRow,
});
