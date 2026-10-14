import { DrawerItem, NoItemsDetailItem } from "@k8slens/details-panel-components";
import { A, Button, Div, Span } from "@k8slens/element-components";
import { ArrowOutwardIcon, CloseIcon, FullscreenIcon } from "@k8slens/icon";
import { Table } from "@k8slens/table-contracts";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { type ReactNode, useEffect, useMemo } from "react";
import { resourcesOfVersion } from "../deployments/version-resources";
import { hostOf, isReleasesWatch, watchOfKey } from "../watched-repositories/watched-repository";
import { openVersionInjectable } from "../workflow-runs/open-version.injectable";
import { workflowsTitleOf } from "../workflow-runs/version";
import { formatAge } from "./format-time-ago";
import { selectedVersionInjectable } from "./selected-version.injectable";
import { TableBox } from "./table-box";
import { versionResourcesTableKind } from "./version-resources-table.injectable";
import { watchOnClusterInjectable } from "./watch-on-cluster.injectable";
import { WorkflowRunCards } from "./workflow-run-cards";
import { openWorkflowsTabInjectable } from "./workflows-tab.injectable";

const HeaderButton = ({
  onClick,
  tooltip,
  children,
}: {
  onClick: () => void;
  tooltip: string;
  children: ReactNode;
}) => (
  <Button $onClick={onClick} $tooltip={tooltip} $interactive $padding="xs">
    {children}
  </Button>
);

const Section = ({ heading, children }: { heading: string; children: ReactNode }) => (
  <Div $flex={{ direction: "vertical", gap: "m" }} $padding={{ vertical: "xl" }}>
    <Span $font={{ size: "xl" }}>{heading}</Span>
    <Div>{children}</Div>
  </Div>
);

const VersionDetails = observer(
  ({ clusterId, watchKey, versionId }: { clusterId: string; watchKey: string; versionId: string }) => {
    const watchState = useInject(watchOnClusterInjectable)(clusterId, watchKey);
    const selected = useInject(selectedVersionInjectable)(clusterId);
    const openVersion = useInject(openVersionInjectable)();
    const openWorkflowsTab = useInject(openWorkflowsTabInjectable)();
    const params = useMemo(
      (): [string, string, string] => [clusterId, watchKey, versionId],
      [clusterId, watchKey, versionId],
    );
    const watch = watchOfKey(watchKey);
    const releases = isReleasesWatch(watch);
    const row = watchState.rows.find((each) => each.version.id === versionId);

    if (!row) {
      return (
        <Div $padding="xl">
          <Span $color="textMuted">This version is no longer among the latest ones.</Span>
        </Div>
      );
    }

    const { version } = row;
    const resources = resourcesOfVersion(row.services, row.syncs).length;

    return (
      <>
        <Div
          $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}
          $padding={{ vertical: "m", horizontal: "xl" }}
          $backgroundColor="backgroundSecondary"
        >
          <Span $font={{ size: "l", bold: true }} $flexChild>
            {releases ? "Release" : "Commit"}: {version.label}
          </Span>
          <HeaderButton onClick={() => void openVersion(version)} tooltip="Open on GitLab">
            <ArrowOutwardIcon $size="s" />
          </HeaderButton>
          <HeaderButton
            onClick={() => void openWorkflowsTab({ clusterId, watchKey, versionId, label: workflowsTitleOf(row) })}
            tooltip="Open the pipelines in a tab, with each job and the end of a failed one's trace"
          >
            <FullscreenIcon $size="s" />
          </HeaderButton>
          <HeaderButton onClick={selected.close} tooltip="Close">
            <CloseIcon $size="s" />
          </HeaderButton>
        </Div>

        {/* The header stays put; the details scroll beneath it. */}
        <Div $padding={{ horizontal: "xl" }} $flexChild $overflow={{ y: "auto" }} $style={{ minHeight: 0 }}>
          <Section heading="Properties">
            <DrawerItem name="Message">{version.title}</DrawerItem>
            {version.author && <DrawerItem name="Author">{version.author}</DrawerItem>}
            <DrawerItem name={releases ? "Published" : "Committed"}>
              {formatAge(version.at)} ago ({new Date(version.at).toLocaleString()})
            </DrawerItem>
            <DrawerItem name={releases ? "Tag" : "Commit"}>
              <A onClick={() => void openVersion(version)} $color="link">
                {releases ? version.label : version.id}
              </A>
            </DrawerItem>
            <DrawerItem name={releases ? "Project" : "Branch"}>
              {releases ? watch.repository : `${watch.repository} · ${watch.branch}`}
            </DrawerItem>
            {version.prerelease && <DrawerItem name="Pre-release">Yes</DrawerItem>}
          </Section>

          <Section heading="On this cluster">
            {!row.services ? (
              <NoItemsDetailItem>Reading what the cluster runs…</NoItemsDetailItem>
            ) : resources === 0 ? (
              <NoItemsDetailItem>Nothing in this cluster runs it.</NoItemsDetailItem>
            ) : (
              <TableBox rows={resources}>
                <Table kind={versionResourcesTableKind} params={params} />
              </TableBox>
            )}
          </Section>

          <Section heading="Pipelines">
            <WorkflowRunCards
              host={hostOf(watch)}
              project={watch.repository}
              row={row}
              onRerun={() => void watchState.refresh()}
              place={JSON.stringify(["panel", clusterId, watchKey, versionId])}
              compact
            />
          </Section>
        </Div>
      </>
    );
  },
);

/**
 * A version's details, sliding in over the dashboard from the right as a Kubernetes resource's do over
 * its list: what it is, what of the cluster runs it, and its workflows.
 */
export const VersionDetailsPanel = observer(({ clusterId }: { clusterId: string }) => {
  const selected = useInject(selectedVersionInjectable)(clusterId);
  const current = selected.current;

  useEffect(() => {
    if (!current) return undefined;

    const closeOnEscape = (event: KeyboardEvent) =>
      event.key === "Escape" && !event.defaultPrevented && selected.close();

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [current, selected]);

  if (!current) return null;

  return (
    <Div
      $flex={{ direction: "vertical" }}
      $backgroundColor="backgroundPrimary"
      $style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(760px, 70%)",
        boxShadow: "-4px 0 16px rgba(0, 0, 0, 0.35)",
        // Above the column resize handles of the tables beneath it.
        zIndex: 100,
      }}
    >
      <VersionDetails clusterId={clusterId} watchKey={current.watchKey} versionId={current.versionId} />
    </Div>
  );
});
