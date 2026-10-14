import { clusterNavigatorItemKind } from "@k8slens/cluster-contracts";
import { DropDownMenuItemRow } from "@k8slens/drop-down-menu-items";
import { GitlabIcon } from "../gitlab-icon";
import {
  getNavigatorItemMenuItemInjectableBunch,
  type NavigatorItemOfKind,
  navigatorItemDropDownMenuOrderNumbers,
} from "@k8slens/navigator-contracts";
import { useInject } from "@k8slens/use-inject";
import { openSettingsTabInjectable } from "../settings/settings-tab.injectable";

const GithubActionsSettings = ({ data }: { data: NavigatorItemOfKind<typeof clusterNavigatorItemKind> }) => {
  const openTab = useInject(openSettingsTabInjectable)();
  const [clusterId] = data.ids;

  return (
    <DropDownMenuItemRow Icon={GitlabIcon} $onClick={() => void openTab(clusterId)}>
      GitLabOps settings
    </DropDownMenuItemRow>
  );
};

export const clusterMenuItemBunch = getNavigatorItemMenuItemInjectableBunch({
  id: "lens-gitlab-cluster-settings",
  forItemsOfKind: clusterNavigatorItemKind,
  orderNumber: navigatorItemDropDownMenuOrderNumbers.sectionEnd + 100,
  Component: GithubActionsSettings,
});
