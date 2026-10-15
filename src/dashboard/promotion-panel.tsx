import { Button, Div, Span } from "@k8slens/element-components";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { byEnvironment, placeOf } from "../deployments/promotion";
import { driftRangeOf, environmentDriftOf, isProductionBranch } from "../pipelines/environments";
import { gitlabEnvironmentsInjectable } from "../pipelines/environments.injectable";
import { hostOf, isReleasesWatch, isSameWatch, type WatchedRepository, watchKeyOf } from "../watched-repositories/watched-repository";
import { watchedRepositoriesStoreInjectable } from "../watched-repositories/watched-repositories-store.injectable";
import { AheadList } from "./ahead-panel";
import { clusterRecordsInjectable } from "./cluster-records.injectable";
import { Panel } from "./panel";
import { watchOnClusterInjectable } from "./watch-on-cluster.injectable";

const Column = observer(({ clusterId, name, watchKey, current }: { clusterId: string; name: string; watchKey: string; current: boolean }) => {
  const watchState = useInject(watchOnClusterInjectable)(clusterId, watchKey);
  const summary = watchState.summary;
  const standing = summary ? placeOf(summary.services, summary.syncs) : undefined;
  const behind = (standing?.place?.behind ?? 0) > 0;

  return (
    <Div $flex={{ direction: "vertical", gap: "xs" }} $style={{ minWidth: "9rem" }}>
      <Span $color={current ? "primary" : "textMuted"}>{name || "Cluster"}</Span>
      <Span $font={{ size: "xl" }} $color={behind ? "notice" : undefined}>
        {watchState.cluster.status === "loading" || watchState.activity.status === "loading"
          ? "…"
          : (standing?.place?.label ?? "–")}
      </Span>
      <Span $color="textMuted">{standing?.detail ?? "checking"}</Span>
    </Div>
  );
});

/** One project across the clusters that watch it, and GitLab's own deployment when the project records one. */
export const PromotionPanel = observer(({ clusterId, watch, checkedAt }: { clusterId: string; watch: WatchedRepository; checkedAt?: Date }) => {
  const records = useInject(clusterRecordsInjectable)().get();
  const storeOf = useInject(watchedRepositoriesStoreInjectable);
  const watchOnCluster = useInject(watchOnClusterInjectable);
  const environments = useInject(gitlabEnvironmentsInjectable)(hostOf(watch), watch.repository);
  const watchKey = watchKeyOf(watch);
  const columns = records
    .filter((record) => storeOf(record.id).all?.some((each) => isSameWatch(each, watch)))
    .map((record) => ({ id: record.id, name: record.name.get() }))
    .sort((left, right) => byEnvironment(left.name, right.name));

  useEffect(() => {
    // Pipelines are read first. Environments are asked once that succeeded, so a signed-out glab is not asked twice.
    if (!checkedAt) return;

    void environments.load();
  }, [environments, checkedAt]);

  const versions = watchOnCluster(clusterId, watchKey).activity;
  const versionList = versions.status === "loaded" ? versions.versions : [];
  const [openDrift, setOpenDrift] = useState<string | undefined>();
  // A cluster that follows main, master or prod is production even when this dashboard follows another branch.
  const productionWatches = records.flatMap((record) => {
    if (columns.some((column) => column.id === record.id)) return [];

    const followed = storeOf(record.id).all?.find(
      (each) =>
        hostOf(each) === hostOf(watch) &&
        each.repository.toLowerCase() === watch.repository.toLowerCase() &&
        !isReleasesWatch(each) &&
        isProductionBranch(each.branch),
    );

    return followed ? [{ id: record.id, name: record.name.get(), watch: followed }] : [];
  });
  const followedElsewhere = [
    ...columns.filter((column) => column.id !== clusterId).map((column) => ({ id: column.id, key: watchKey })),
    ...productionWatches.map((each) => ({ id: each.id, key: watchKeyOf(each.watch) })),
  ]
    .map((each) => `${each.id}\n${each.key}`)
    .join("\n\n");

  useEffect(() => {
    if (!followedElsewhere) return undefined;

    const stops = followedElsewhere.split("\n\n").map((line) => {
      const [id, key] = line.split("\n");

      return watchOnCluster(id!, key!).watch();
    });

    return () => stops.forEach((stop) => stop());
  }, [watchOnCluster, followedElsewhere]);
  const clusterOf = (id: string, name: string, followed: WatchedRepository, current: boolean) => {
    const summary = watchOnCluster(id, watchKeyOf(followed)).summary;
    const standing = summary && placeOf(summary.services, summary.syncs);

    return {
      name,
      branch: isReleasesWatch(followed) ? undefined : followed.branch,
      current,
      runningId: standing?.place?.id,
      runningLabel: standing?.place?.label,
    };
  };
  const drifts =
    environments.state.status === "loaded"
      ? environmentDriftOf(
          environments.state.deployments,
          [
            ...columns.map((column) => clusterOf(column.id, column.name, watch, column.id === clusterId)),
            ...productionWatches.map((each) => clusterOf(each.id, each.name, each.watch, each.id === clusterId)),
          ],
          versionList,
        )
      : [];
  const showColumns = columns.length > 1;
  const showDrift = drifts.length > 0;

  const environmentsFailed = environments.state.status === "failed" && !!checkedAt;

  if (!showColumns && !showDrift && !environmentsFailed) return null;

  return (
    <Panel heading="Environments" aside={showColumns ? "dev → stage → prod" : "what GitLab last deployed"}>
      {showColumns && (
        <Div $flex={{ direction: "horizontal", gap: "xl", wrap: true }}>
          {columns.map((column) => (
            <Column
              key={column.id}
              clusterId={column.id}
              name={column.name}
              watchKey={watchKey}
              current={column.id === clusterId}
            />
          ))}
        </Div>
      )}
      {showDrift && (
        <Div $flex={{ direction: "vertical", gap: "s" }}>
          {drifts.map((drift) => {
            const range =
              drift.drift && drift.runningId ? driftRangeOf(drift.runningId, drift.gitlabSha, versionList) : undefined;
            const open = openDrift === drift.environment;

            return (
              <Div key={drift.environment} $flex={{ direction: "vertical", gap: "s" }}>
                <Div $flex={{ direction: "horizontal", gap: "m", verticalAlign: "center" }}>
                  <Span $style={{ minWidth: "8rem" }}>{drift.environment}</Span>
                  <Span>GitLab {drift.gitlab}</Span>
                  <Span $color="textMuted">
                    {drift.clusterName
                      ? `${drift.clusterName} ${drift.running ?? "nothing running"}`
                      : "no cluster of this name"}
                  </Span>
                  {range && (
                    <Button
                      $onClick={() => setOpenDrift(open ? undefined : drift.environment)}
                      $tooltip="Commits and merge requests between the cluster and GitLab"
                      $interactive
                    >
                      <Span $color="notice">Drift</Span>
                    </Button>
                  )}
                </Div>
                {open && range && (
                  <AheadList
                    host={hostOf(watch)}
                    project={watch.repository}
                    from={range.from}
                    to={range.to}
                    branch={drift.branch ?? (isReleasesWatch(watch) ? undefined : watch.branch)}
                    checkedAt={checkedAt}
                  />
                )}
              </Div>
            );
          })}
        </Div>
      )}
      {environmentsFailed && environments.state.status === "failed" && (
        <Span $color="textMuted" $tooltip={environments.state.problem.detail}>
          GitLab environments could not be read: {environments.state.problem.title}
        </Span>
      )}
    </Panel>
  );
});
