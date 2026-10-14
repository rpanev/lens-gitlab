import { Div, Span } from "@k8slens/element-components";
import { GitlabIcon } from "../gitlab-icon";
import { mainViewTabHostKind } from "@k8slens/main-view-contracts";
import { getTabKind, getTabKindInjectableBunch, type TabProps } from "@k8slens/tab-contracts";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { clusterNameInjectable } from "../cluster/cluster-name.injectable";
import { getOpenClusterTabInjectable } from "../cluster/get-open-cluster-tab-injectable";
import { WatchedRepositoryForm } from "./watched-repository-form";
import { WatchedRepositoryList } from "./watched-repository-list";

// One tab per cluster: its id is the cluster's id.
export const settingsTabKind = getTabKind()("lens-gitlab-settings");

export const openSettingsTabInjectable = getOpenClusterTabInjectable(
  "lens-gitlab-open-settings-tab",
  settingsTabKind,
);

const SettingsTitle = observer(({ tabId }: TabProps<typeof mainViewTabHostKind>) => {
  const clusterName = useInject(clusterNameInjectable)(tabId).get();

  return (
    <Div $flex={{ direction: "horizontal", gap: "xs", verticalAlign: "center" }}>
      <GitlabIcon $size="s" />
      <Span>GitLabOps settings{clusterName && `: ${clusterName}`}</Span>
    </Div>
  );
});

const Settings = ({ tabId }: TabProps<typeof mainViewTabHostKind>) => (
  <Div $height="full" $overflow={{ y: "auto" }}>
    <Div $flex={{ direction: "vertical", gap: "xxl" }} $padding="xl" $width="full" $style={{ maxWidth: 720 }}>
      <WatchedRepositoryList clusterId={tabId} />
      <WatchedRepositoryForm clusterId={tabId} />
    </Div>
  </Div>
);

export const settingsTabBunch = getTabKindInjectableBunch({
  tabHostKind: mainViewTabHostKind,
  kind: settingsTabKind,
  Component: Settings,
  Title: SettingsTitle,
});
