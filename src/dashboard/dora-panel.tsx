import { Button, Div, Span } from "@k8slens/element-components";
import { KeyboardArrowDownIcon } from "@k8slens/icon";
import { type SelectOption, SingleSelect } from "@k8slens/input-components";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { imageIsOfCommit, imageIsOfRelease } from "../deployments/cluster-images";
import type { ReplicaRollout } from "../deployments/cluster-images";
import type { GitOpsSync } from "../deployments/gitops-syncs";
import type { Service } from "../deployments/services";
import {
  changeFailureOf,
  ciFinishedAtOf,
  deployOf,
  deploymentReworkOf,
  deploysPerDayOf,
  type DoraDeploy,
  type DoraVia,
  doraWeekMs,
  formatDuration,
  latestRunningOf,
  leadLineOf,
  leadTimeOf,
  medianLeadTimeOf,
  medianRestoreOf,
  withHotfixes,
  withRollbacks,
} from "../dora/dora";
import { doraStoreInjectable } from "../dora/dora-store.injectable";
import type { Version, VersionRuns } from "../pipelines/version";
import { isReleasesWatch, type WatchedRepository, watchKeyOf } from "../watched-repositories/watched-repository";
import { watchOnClusterInjectable } from "./watch-on-cluster.injectable";

const viaOf = (kind?: string): DoraVia | undefined =>
  kind === "Application" ? "argo" : kind === "Kustomization" || kind === "HelmRelease" ? "flux" : undefined;

const latestTime = (times: readonly (string | undefined)[]) => times.flatMap((time) => (time ? [time] : [])).sort().at(-1);

const sameImages = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((image) => right.includes(image));

/** Deploys Flux or Argo CD made of one project, including ReplicaSets of versions no longer running. */
export const deploysOfWatch = (
  watch: WatchedRepository,
  versions: readonly Version[],
  recent: readonly VersionRuns[],
  services: readonly Service[],
  syncs: readonly GitOpsSync[],
  replicaSets: readonly ReplicaRollout[],
): DoraDeploy[] => {
  const releases = isReleasesWatch(watch);
  const matches = (image: string, version: Version) =>
    releases ? imageIsOfRelease(image, version.id) : imageIsOfCommit(image, version.id);
  const versionOf = (id?: string) => versions.find((version) => version.id === id);
  const ciOf = (id: string) => ciFinishedAtOf(recent.find((row) => row.version.id === id)?.runs ?? []);
  const deploys: DoraDeploy[] = [];
  const seen = new Set<string>();

  const add = (deploy: DoraDeploy) => {
    if (seen.has(deploy.id)) return;

    seen.add(deploy.id);
    deploys.push(deploy);
  };

  for (const service of services) {
    const via = viaOf(service.deployer?.kind);
    const running = service.running;
    const version = versionOf(running?.id);

    if (!via || !running || !version) continue;

    const stalled = service.workloads.some((workload) => workload.stalled);
    const rolledOut = service.workloads.length > 0 && service.workloads.every((workload) => workload.rolledOut);
    const settledAt = latestTime(service.workloads.map((workload) => workload.settledAt));
    const startedAt = latestTime(service.workloads.map((workload) => workload.rolloutStartedAt));
    const applyFailed =
      service.deployer?.state === "failed" &&
      (!service.deployer.attemptedCommit || service.deployer.attemptedCommit === version.id);

    add(
      deployOf({
        repository: watch.repository,
        target: service.name,
        via,
        versionId: version.id,
        versionLabel: version.label,
        versionTitle: version.title,
        committedAt: version.at,
        ciFinishedAt: ciOf(version.id),
        appliedAt: service.deployer?.appliedAt,
        runningAt: rolledOut ? (settledAt ?? startedAt) : undefined,
        approximate: rolledOut && !settledAt && !!startedAt,
        failed: stalled || applyFailed,
        failure: stalled ? "rollout" : applyFailed ? "apply" : undefined,
      }),
    );

    const attempted = versionOf(service.deployer?.attemptedCommit);

    if (service.deployer?.state === "failed" && attempted && attempted.id !== version.id) {
      add(
        deployOf({
          repository: watch.repository,
          target: service.name,
          via,
          versionId: attempted.id,
          versionLabel: attempted.label,
          versionTitle: attempted.title,
          committedAt: attempted.at,
          ciFinishedAt: ciOf(attempted.id),
          failed: true,
          failure: "apply",
        }),
      );
    }
  }

  const covered = new Set(
    services.flatMap((service) =>
      service.deployer ? [`${service.deployer.kind}/${service.deployer.namespace}/${service.deployer.name}`] : [],
    ),
  );

  for (const sync of syncs) {
    const via = viaOf(sync.resource.kind);
    const version = versionOf(sync.applied?.id);
    const key = `${sync.resource.kind}/${sync.resource.namespace}/${sync.resource.name}`;

    if (!via || !version || covered.has(key)) continue;

    const failed = sync.resource.state === "failed" || sync.pending?.stage === "failed";

    add(
      deployOf({
        repository: watch.repository,
        target: `${sync.resource.kind} ${sync.resource.name}`,
        via,
        versionId: version.id,
        versionLabel: version.label,
        versionTitle: version.title,
        committedAt: version.at,
        ciFinishedAt: ciOf(version.id),
        appliedAt: sync.resource.appliedAt,
        runningAt: sync.resource.state === "ready" ? sync.resource.appliedAt : undefined,
        failed,
        failure: failed ? "apply" : undefined,
      }),
    );
  }

  const workloads = services.flatMap((service) => service.workloads);

  for (const set of replicaSets) {
    const version = versions.find((each) => set.images.some((image) => matches(image, each)));
    const workload = workloads.find(
      (each) => each.kind === "Deployment" && each.namespace === set.namespace && each.name === set.ownerName,
    );
    const via = viaOf(workload?.owner?.kind);

    if (!version || !via || (workload && sameImages(workload.images, set.images))) continue;

    add(
      deployOf({
        repository: watch.repository,
        target: set.ownerName,
        via,
        versionId: version.id,
        versionLabel: version.label,
        versionTitle: version.title,
        committedAt: version.at,
        ciFinishedAt: ciOf(version.id),
        runningAt: set.createdAt,
        approximate: true,
        failed: false,
      }),
    );
  }

  return deploys;
};

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

const Count = ({ value, label, color }: { value: string; label: string; color?: "success" | "critical" | "notice" | "primary" }) => (
  <Div $flex={{ direction: "horizontal", gap: "xs", verticalAlign: "center" }}>
    <Span $font={{ size: "l" }} $color={color}>
      {value}
    </Span>
    <Span $color="textMuted">{label}</Span>
  </Div>
);

/** One option per watched project. Two watches of the same project share its deploys. */
const repositoryOptionsOf = (watches: readonly WatchedRepository[]): SelectOption<string>[] => {
  const seen = new Set<string>();
  const options: SelectOption<string>[] = [];

  for (const watch of watches) {
    const key = watch.repository.toLowerCase();

    if (seen.has(key)) continue;

    seen.add(key);
    options.push({ id: watch.repository, label: watch.repository });
  }

  return options;
};

/** Lead time and change failure rate of one watched project, from deploys Flux or Argo CD made. */
export const DoraPanel = observer(({ clusterId, watches }: { clusterId: string; watches: readonly WatchedRepository[] }) => {
  const watchOnCluster = useInject(watchOnClusterInjectable);
  const store = useInject(doraStoreInjectable)(clusterId);
  const incoming = watches.flatMap((watch) => {
    const state = watchOnCluster(clusterId, watchKeyOf(watch));

    if (state.activity.status !== "loaded" || !state.summary) return [];

    return deploysOfWatch(
      watch,
      state.activity.versions,
      state.activity.recent,
      state.summary.services,
      state.summary.syncs,
      state.cluster.status === "loaded" ? (state.cluster.images.replicaSets ?? []) : [],
    );
  });
  const signature = incoming.map((deploy) => JSON.stringify(deploy)).join("\n");

  useEffect(() => {
    if (!signature) return;

    void store.record(incoming);
    // signature is the incoming deploys; recording again with the same ones would rewrite nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, signature]);

  const remembered = store.all ?? [];
  const options = repositoryOptionsOf(watches);
  const [chosen, setChosen] = useState<string | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const chosenStillWatched = options.find((option) => option.id.toLowerCase() === chosen?.toLowerCase());
  const openedOn = latestRunningOf(remembered)?.repository;
  const openedStillWatched = options.find((option) => option.id.toLowerCase() === openedOn?.toLowerCase());
  const repository = chosenStillWatched?.id ?? openedStillWatched?.id ?? options[0]?.id;
  const selected = repository
    ? remembered.filter((deploy) => deploy.repository.toLowerCase() === repository.toLowerCase())
    : remembered;
  const deploys = withHotfixes(withRollbacks(selected));
  const now = Date.now();
  const median = medianLeadTimeOf(deploys, now);
  const failure = changeFailureOf(deploys, now);
  const latest = latestRunningOf(deploys);
  const line = latest && leadLineOf(latest);
  const lead = latest && leadTimeOf(latest);
  const counted = deploys.filter((deploy) => deploy.runningAt).length;

  const leadLabel = median === undefined ? "–" : formatDuration(median);
  const failureLabel = failure.rate === undefined ? "–" : percent(failure.rate);
  const perDay = deploysPerDayOf(failure.total);
  const frequencyLabel =
    perDay === undefined ? "–" : Number.isInteger(perDay) ? `${perDay}/day` : `${perDay.toFixed(1)}/day`;
  const restore = medianRestoreOf(deploys, now);
  const rework = deploymentReworkOf(deploys, now);
  const reworkLabel = rework.rate === undefined ? "–" : percent(rework.rate);
  const duration = (ms: number | undefined) => (ms === undefined ? "–" : formatDuration(ms));

  return (
    <Div $flex={{ direction: "vertical" }} $width="full" $height="full">
      <Div
        $flex={{ direction: "horizontal", gap: "xl", verticalAlign: "center", wrap: true }}
        $padding={{ horizontal: "xl", vertical: "m" }}
        $border={{ bottom: { width: "xxs", color: "grey60" } }}
      >
        <Count value={leadLabel} label="Change lead time" color={median === undefined ? undefined : "primary"} />
        <Count value={frequencyLabel} label="Deployment frequency" color={perDay === undefined ? undefined : "primary"} />
        <Count value={duration(restore)} label="Recovery time" color={restore === undefined ? undefined : "notice"} />
        <Count
          value={failureLabel}
          label="Change fail rate"
          color={failure.rate === undefined ? undefined : failure.failed > 0 ? "notice" : "success"}
        />
        <Count
          value={reworkLabel}
          label="Rework rate"
          color={rework.rate === undefined ? undefined : rework.rework > 0 ? "notice" : "success"}
        />
        <Div $flexChild />
        {repository && (
          <Div $anchor $onOutsideClick={() => setMenuOpen(false)}>
            <Button
              $onClick={() => setMenuOpen((open) => !open)}
              $tooltip="Choose the project"
              $interactive
              $border={{ color: "borderPrimary", width: "xxs", radius: "s" }}
              $padding={{ horizontal: "m", vertical: "xs" }}
              $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}
            >
              <Span>{repository}</Span>
              <KeyboardArrowDownIcon $size="s" />
            </Button>
            {menuOpen && (
              <Div
                $anchoredAt="bottom span-right"
                $backgroundColor="backgroundSecondary"
                $border={{ color: "borderPrimary", width: "xxs", radius: "s" }}
                $boxShadow="elevated"
                $style={{ minWidth: "16rem" }}
              >
                <SingleSelect
                  options={options}
                  selected={repository}
                  onSelect={(id) => {
                    setChosen(id);
                    setMenuOpen(false);
                  }}
                />
              </Div>
            )}
          </Div>
        )}
        <Span $color="textMuted">last {doraWeekMs / (24 * 60 * 60 * 1000)} days · this Lens</Span>
      </Div>
      <Div $flex={{ direction: "vertical", gap: "s" }} $padding="xl">
        {latest && line && lead !== undefined ? (
          <>
            <Span>
              {latest.repository} · {latest.target} · {latest.versionLabel} · {formatDuration(lead)}
              {latest.via === "argo" ? " · Argo CD" : " · Flux"}
            </Span>
            <Span $color="textMuted">{line}</Span>
            {latest.approximate && (
              <Span $color="textMuted">
                The running time is when Kubernetes created the ReplicaSet, which it still keeps.
              </Span>
            )}
          </>
        ) : (
          <Span $color="textMuted">
            {counted === 0
              ? "A deploy counts once Flux or Argo CD has applied it. ReplicaSets the cluster still keeps fill in rollouts from before Lens was open."
              : "Stages appear once a pipeline finish and an apply time are both known."}
          </Span>
        )}
      </Div>
    </Div>
  );
});
