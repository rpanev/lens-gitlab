import { Div, Span } from "@k8slens/element-components";
import { GitlabIcon } from "../gitlab-icon";
import { PrimaryButton } from "@k8slens/input-components";
import { mainViewTabHostKind } from "@k8slens/main-view-contracts";
import { getTabKindInjectableBunch, type TabProps } from "@k8slens/tab-contracts";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { useEffect } from "react";
import { activeClusterHealthInjectable } from "../status-bar/active-cluster-health.injectable";
import { clusterNameInjectable } from "../cluster/cluster-name.injectable";
import { openSettingsTabInjectable } from "../settings/settings-tab.injectable";
import { watchKeyOf } from "../watched-repositories/watched-repository";
import { watchedRepositoriesStoreInjectable } from "../watched-repositories/watched-repositories-store.injectable";
import { DashboardAssistant } from "./assistant";
import { HealthBanner } from "./health-banner";
import { dashboardTabKind } from "./open-dashboard-tab.injectable";
import { ProjectSummaries } from "./project-summaries";
import { RepositorySection } from "./repository-section";
import { VersionDetailsPanel } from "./version-details-panel";

const DashboardTitle = observer(({ tabId }: TabProps<typeof mainViewTabHostKind>) => {
  const clusterName = useInject(clusterNameInjectable)(tabId).get();

  return (
    <Div $flex={{ direction: "horizontal", gap: "xs", verticalAlign: "center" }}>
      <GitlabIcon $size="s" />
      <Span>GitLabOps{clusterName && `: ${clusterName}`}</Span>
    </Div>
  );
});

const NotConfigured = ({ onConfigure }: { onConfigure: () => void }) => (
  <Div $flex={{ direction: "vertical", gap: "m", horizontalAlign: "center" }} $padding="xl">
    <GitlabIcon $size="xxl" />
    <Span $font={{ size: "l", bold: true }}>GitLabOps is not configured for this cluster</Span>
    <Span $color="textMuted">
      Choose the projects, and their branches or releases, whose pipelines you want to follow here.
    </Span>
    <PrimaryButton onClick={onConfigure}>Configure GitLabOps</PrimaryButton>
  </Div>
);

const Dashboard = observer(({ tabId }: TabProps<typeof mainViewTabHostKind>) => {
  const watched = useInject(watchedRepositoriesStoreInjectable)(tabId).all;
  const activeClusterHealth = useInject(activeClusterHealthInjectable)();

  // Lens counts this tab as about no cluster, so the status bar is told which one it is about.
  useEffect(() => activeClusterHealth.lookedAt(tabId), [activeClusterHealth, tabId]);
  const openSettings = useInject(openSettingsTabInjectable)();
  const configure = () => void openSettings(tabId);

  if (!watched) return null;

  return (
    <Div $flex={{ direction: "vertical" }} $width="full" $height="full">
      {watched.length === 0 ? (
        <Div $flexChild>
          <NotConfigured onConfigure={configure} />
        </Div>
      ) : (
        <>
          <HealthBanner
            clusterId={tabId}
            aside={`${watched.length} ${watched.length === 1 ? "project" : "projects"} watched`}
            onSettings={configure}
          />

          {/* The banner stays put; what is below it scrolls within the tab, and a version's details slide in over it. */}
          <Div $flexChild $relative $style={{ minHeight: 0 }}>
            <Div $flex={{ direction: "vertical", gap: "3xl" }} $padding="xxl" $height="full" $overflow={{ y: "auto" }}>
              <ProjectSummaries clusterId={tabId} watches={watched} />
              {watched.map((watch) => (
                <RepositorySection key={watchKeyOf(watch)} clusterId={tabId} watch={watch} />
              ))}
            </Div>
            <VersionDetailsPanel clusterId={tabId} />
          </Div>
        </>
      )}
      <DashboardAssistant clusterId={tabId} />
    </Div>
  );
});

export const dashboardTabBunch = getTabKindInjectableBunch({
  tabHostKind: mainViewTabHostKind,
  kind: dashboardTabKind,
  Component: Dashboard,
  Title: DashboardTitle,
});
