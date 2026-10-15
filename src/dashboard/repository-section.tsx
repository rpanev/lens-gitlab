import { Button, Div, Span } from "@k8slens/element-components";
import { CheckCircleIcon, RefreshIcon } from "@k8slens/icon";
import { GitlabIcon } from "../gitlab-icon";
import { Table } from "@k8slens/table-contracts";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { useEffect, useMemo } from "react";
import {
  followedLabelOf,
  isReleasesWatch,
  type WatchedRepository,
  watchKeyOf,
} from "../watched-repositories/watched-repository";
import { clusterRetrySeconds } from "../deployments/cluster-images.injectable";
import { liveCheckSeconds } from "../pipelines/track-activity.injectable";
import { versionsAsked, versionsWithRuns } from "../pipelines/track-sources.injectable";
import { pipelinesPassingOf } from "../pipelines/version";
import { gitOpsSyncsTableKind } from "./gitops-syncs-table.injectable";
import { GlabProblemNotice } from "./glab-problem-notice";
import { PromotionPanel } from "./promotion-panel";
import { Panel } from "./panel";
import { servicesTableKind } from "./services-table.injectable";
import { StatCard } from "./stat-card";
import { TableBox } from "./table-box";
import { versionsTableKind } from "./versions-table.injectable";
import { followWatchInjectable } from "../notifications/follow-watch.injectable";
import { watchOnClusterInjectable } from "./watch-on-cluster.injectable";

const checkedLabel = (activity: { mode: "live" | "idle"; checkedAt: Date }) =>
  activity.mode === "live"
    ? `live · checking every ${liveCheckSeconds}s`
    : `checked ${activity.checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

export const RepositorySection = observer(({ clusterId, watch }: { clusterId: string; watch: WatchedRepository }) => {
  const watchKey = watchKeyOf(watch);
  const watchState = useInject(watchOnClusterInjectable)(clusterId, watchKey);
  const followWatch = useInject(followWatchInjectable)();
  const { activity, cluster, summary, rows } = watchState;
  const params = useMemo((): [string, string] => [clusterId, watchKey], [clusterId, watchKey]);
  const releases = isReleasesWatch(watch);
  const unit = releases ? "release" : "commit";
  const syncs = summary?.syncs ?? [];
  // A repository the cluster runs no images of, but applies with Flux or Argo CD: a GitOps repository.
  const gitOpsOnly = !!summary && summary.services.length === 0 && syncs.length > 0;
  const pipelines = pipelinesPassingOf(rows);

  // Follows GitLab and the cluster while the dashboard shows them, and stops when it does not.
  // Notifications follow it too, for as long as the dashboard shows it.
  useEffect(() => followWatch(clusterId, watchKey), [followWatch, clusterId, watchKey]);

  return (
    <Div $flex={{ direction: "vertical", gap: "l" }}>
      <Div $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}>
        <GitlabIcon $size="m" />
        <Span $font={{ size: "xl" }}>{watch.repository}</Span>
        <Span $color="textMuted" $font={{ size: "xl" }} $flexChild>
          {followedLabelOf(watch)}
        </Span>
        {activity.status === "loaded" && (
          <Span $color={activity.mode === "live" ? "primary" : "textMuted"}>{checkedLabel(activity)}</Span>
        )}
        <Button $onClick={() => void watchState.refresh()} $tooltip="Check now" $interactive>
          <RefreshIcon $size="s" />
        </Button>
      </Div>

      {activity.status === "failed" && (
        <Panel>
          <GlabProblemNotice problem={activity.problem} hadData={false} />
        </Panel>
      )}

      {activity.status === "loaded" && activity.warning && (
        <Panel>
          <GlabProblemNotice problem={activity.warning} hadData />
        </Panel>
      )}

      <Div $flex={{ direction: "horizontal", gap: "xl" }}>
        {gitOpsOnly ? (
          <StatCard
            icon={<CheckCircleIcon $size="m" />}
            title="Syncs"
            value={`${syncs.filter((sync) => sync.applied?.behind === 0 && !sync.pending).length}/${syncs.length}`}
            label="on the latest commit"
          />
        ) : (
          <StatCard
            icon={<CheckCircleIcon $size="m" />}
            title="Services"
            value={summary && summary.services.length > 0 ? `${summary.onNewest}/${summary.services.length}` : "–"}
            label={summary && summary.services.length === 0 ? "none on this cluster" : `on the latest ${unit}`}
          />
        )}
        <StatCard
          icon={<GitlabIcon $size="m" />}
          title="Versions"
          value={
            !summary
              ? "–"
              : gitOpsOnly
                ? new Set(syncs.flatMap((sync) => (sync.applied ? [sync.applied.id] : []))).size
                : summary.versionsRunning
          }
          label={gitOpsOnly ? "applied" : "running"}
        />
        <StatCard
          icon={<RefreshIcon $size="m" />}
          title="Pipelines"
          value={activity.status === "loaded" && pipelines.ran > 0 ? `${pipelines.passing}/${pipelines.ran}` : "–"}
          label={
            activity.status === "loaded" && pipelines.ran === 0
              ? `no runs of recent ${unit}s`
              : `recent ${unit}s passing`
          }
        />
      </Div>

      <PromotionPanel
        clusterId={clusterId}
        watch={watch}
        checkedAt={activity.status === "loaded" ? activity.checkedAt : undefined}
      />

      <Panel heading={releases ? "Recent releases" : "Recent commits"} aside={`last ${versionsWithRuns}`}>
        <TableBox rows={rows.length || versionsWithRuns}>
          <Table kind={versionsTableKind} params={params} />
        </TableBox>
      </Panel>

      {syncs.length > 0 && (
        <Panel
          heading={`GitOps syncs (${syncs.length})`}
          aside="Kustomizations and Argo CD Applications applying this branch"
        >
          <TableBox rows={syncs.length}>
            <Table kind={gitOpsSyncsTableKind} params={params} />
          </TableBox>
        </Panel>
      )}

      {!gitOpsOnly && (
        <Panel heading={`Services${summary ? ` (${summary.services.length})` : ""}`}>
          {cluster.status === "failed" ? (
            <Div $flex={{ direction: "vertical", gap: "xs" }}>
              <Span $color="warning">Could not read what this cluster runs: {cluster.message}</Span>
              <Span $color="textMuted">Trying again every {clusterRetrySeconds} seconds.</Span>
            </Div>
          ) : !summary ? (
            <Span $color="textMuted">Reading what the cluster runs…</Span>
          ) : summary.services.length === 0 ? (
            <Span $color="textMuted">
              Nothing in this cluster runs a build of the last {versionsAsked} {unit}s.
            </Span>
          ) : (
            <TableBox rows={summary.services.length}>
              <Table kind={servicesTableKind} params={params} />
            </TableBox>
          )}
        </Panel>
      )}
    </Div>
  );
});
