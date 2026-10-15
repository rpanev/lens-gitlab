import { Div, Span } from "@k8slens/element-components";
import { PrimaryButton } from "@k8slens/input-components";
import { mainViewTabHostKind } from "@k8slens/main-view-contracts";
import { getTabKind, getTabKindInjectableBunch, type TabProps } from "@k8slens/tab-contracts";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { useEffect } from "react";
import { getOpenClusterTabInjectable } from "../cluster/get-open-cluster-tab-injectable";
import { clusterNameInjectable } from "../cluster/cluster-name.injectable";
import { GitlabIcon } from "../gitlab-icon";
import { followWatchInjectable } from "../notifications/follow-watch.injectable";
import { activeClusterHealthInjectable } from "../status-bar/active-cluster-health.injectable";
import { watchKeyOf } from "../watched-repositories/watched-repository";
import { watchedRepositoriesStoreInjectable } from "../watched-repositories/watched-repositories-store.injectable";
import { DoraPanel } from "./dora-panel";
import { openSettingsTabInjectable } from "../settings/settings-tab.injectable";

export const doraTabKind = getTabKind()("lens-gitlab-dora");

export const openDoraTabInjectable = getOpenClusterTabInjectable("lens-gitlab-open-dora-tab", doraTabKind);

const DoraTitle = observer(({ tabId }: TabProps<typeof mainViewTabHostKind>) => {
  const clusterName = useInject(clusterNameInjectable)(tabId).get();

  return (
    <Div $flex={{ direction: "horizontal", gap: "xs", verticalAlign: "center" }}>
      <GitlabIcon $size="s" />
      <Span>DORA{clusterName && `: ${clusterName}`}</Span>
    </Div>
  );
});

const Dora = observer(({ tabId }: TabProps<typeof mainViewTabHostKind>) => {
  const watched = useInject(watchedRepositoriesStoreInjectable)(tabId).all;
  const followWatch = useInject(followWatchInjectable)();
  const activeClusterHealth = useInject(activeClusterHealthInjectable)();
  const openSettings = useInject(openSettingsTabInjectable)();
  const keys = watched?.map(watchKeyOf).join("\n") ?? "";

  useEffect(() => activeClusterHealth.lookedAt(tabId), [activeClusterHealth, tabId]);

  useEffect(() => {
    if (!keys) return undefined;

    const stops = keys.split("\n").map((key) => followWatch(tabId, key));

    return () => stops.forEach((stop) => stop());
  }, [followWatch, tabId, keys]);

  if (!watched) return null;

  if (watched.length === 0) {
    return (
      <Div $flex={{ direction: "vertical", gap: "m", horizontalAlign: "center" }} $padding="xl">
        <GitlabIcon $size="xxl" />
        <Span $font={{ size: "l", bold: true }}>GitLabOps is not configured for this cluster</Span>
        <Span $color="textMuted">DORA counts the deploys of the projects watched here.</Span>
        <PrimaryButton onClick={() => void openSettings(tabId)}>Configure GitLabOps</PrimaryButton>
      </Div>
    );
  }

  return <DoraPanel clusterId={tabId} watches={watched} />;
});

export const doraTabBunch = getTabKindInjectableBunch({
  tabHostKind: mainViewTabHostKind,
  kind: doraTabKind,
  Component: Dora,
  Title: DoraTitle,
});
