import { serviceLookOf } from "../dashboard/flux-stage";
import type { GitOpsSync } from "../deployments/gitops-syncs";
import type { Service } from "../deployments/services";
import { runStatusOf } from "../pipelines/run-status";
import type { VersionRuns } from "../pipelines/version";

export interface Failure {
  readonly message: string;
  /** The commit, release or chart version that fails: another one failing is another failure. */
  readonly version?: string;
}

// What a service fails to apply: a chart, a build picked up by image automation, or what its deployer tried.
const failedVersionOf = (service: Service) =>
  (service.chart?.pending?.stage === "failed" && service.chart.pending.version) ||
  (service.pickedUp?.stage === "failed" && service.pickedUp.id) ||
  service.deployer?.attemptedCommit ||
  service.deployer?.chart?.attempted;

/** What notifications compare from one check to the next, for one watch on one cluster. */
export interface Reading {
  /** The newest version, and whether its CI failed, once its runs have all finished. */
  readonly newest?: { readonly id: string; readonly label: string; readonly failedPipelines: readonly string[] };
  /** What fails to apply, by name, with why and the version that fails, when known. */
  readonly failing: ReadonlyMap<string, Failure>;
  /** What is being applied again, by the same names: a retry, which does not end a failure. */
  readonly retrying: ReadonlySet<string>;
  /** The version each service runs, once it has settled on it: rolled out, nothing newer on its way. */
  readonly settled: ReadonlyMap<string, { readonly id: string; readonly label: string }>;
  /** Why the cluster or GitLab cannot be read, while it cannot. */
  readonly unreadable?: string;
}

export const readingOf = ({
  newest,
  services,
  syncs,
  unreadable,
}: {
  newest?: VersionRuns;
  services: readonly Service[];
  syncs: readonly GitOpsSync[];
  unreadable?: string;
}): Reading => {
  const finished = newest && newest.runs.length > 0 && newest.runs.every((run) => run.status === "completed");

  return {
    newest:
      newest && finished
        ? {
            id: newest.version.id,
            label: newest.version.label,
            failedPipelines: newest.runs
              .filter((run) => runStatusOf(run).color === "critical")
              .map((run) => run.name),
          }
        : undefined,
    failing: new Map([
      ...services
        .filter((service) => serviceLookOf(service) === "failed")
        .map((service): [string, Failure] => [
          service.name,
          { message: service.deployer?.message ?? "failed to apply", version: failedVersionOf(service) },
        ]),
      ...syncs
        .filter((sync) => sync.pending?.stage === "failed")
        .map((sync): [string, Failure] => [
          `${sync.resource.kind} ${sync.resource.name}`,
          { message: sync.resource.message ?? "failed to apply", version: sync.pending?.id },
        ]),
    ]),
    // A deployer reconciling again; a chart upgrade or a build picked up is a new version, not a retry.
    retrying: new Set([
      ...services.filter((service) => service.deployer?.state === "reconciling").map((service) => service.name),
      ...syncs
        .filter((sync) => sync.resource.state === "reconciling")
        .map((sync) => `${sync.resource.kind} ${sync.resource.name}`),
    ]),
    settled: new Map(
      services.flatMap((service) =>
        service.running && !service.rollingOut && !service.pickedUp && !service.chart?.pending
          ? [[service.name, { id: service.running.id, label: service.running.label }] as const]
          : [],
      ),
    ),
    unreadable,
  };
};

export type Change =
  /** Services that settled on a newer version, by the version. */
  | { readonly kind: "live"; readonly label: string; readonly services: readonly string[] }
  | { readonly kind: "ci-failed"; readonly label: string; readonly pipelines: readonly string[] }
  | { readonly kind: "failing"; readonly name: string; readonly message: string }
  | { readonly kind: "unreadable"; readonly message: string };

/**
 * What changed between two readings that is worth telling: only changes, so what was already so at the
 * first reading, such as a deployment that was failing when Lens started, tells nothing.
 */
export const changesBetween = (previous: Reading | undefined, next: Reading): Change[] => {
  if (!previous) return [];

  const changes: Change[] = [];

  if (next.unreadable && !previous.unreadable) changes.push({ kind: "unreadable", message: next.unreadable });

  // A version that failed is told once: when its runs finish, or when it is first seen finished.
  if (
    next.newest &&
    next.newest.failedPipelines.length > 0 &&
    (previous.newest?.id !== next.newest.id || previous.newest.failedPipelines.length === 0)
  )
    changes.push({ kind: "ci-failed", label: next.newest.label, pipelines: next.newest.failedPipelines });

  // Newly failing, or failing on another version than before: a retry of the same one tells nothing, and
  // neither does a version known on one side only, since it cannot tell another version apart.
  for (const [name, { message, version }] of next.failing) {
    const before = previous.failing.get(name);

    if (!before || (version && before.version && version !== before.version))
      changes.push({ kind: "failing", name, message });
  }

  // Services settling on another version than they had, grouped by the version, in the order first seen.
  const live = new Map<string, string[]>();

  for (const [service, version] of next.settled) {
    const before = previous.settled.get(service);

    if (before && before.id !== version.id) live.set(version.label, [...(live.get(version.label) ?? []), service]);
  }

  for (const [label, services] of live) changes.push({ kind: "live", label, services });

  return changes;
};

/** Which changes a watch asks to be told of. */
export const isNotified = (change: Change, notify: "all" | "failures" | "off" = "all") =>
  notify === "all" || (notify === "failures" && change.kind !== "live");

/**
 * The reading to compare the next one with: a service mid-rollout is not settled on any version, so its
 * last settled one is kept to tell when it settles on a newer one; a failure stays while what failed is
 * being applied again, since Flux and Argo CD retry what fails and a retry failing too is the same
 * failure; and while nothing can be read, what was known stays, so recovering does not tell again of
 * what was already failing.
 */
export const carryForward = (previous: Reading | undefined, next: Reading): Reading | undefined => {
  // Nothing read yet is no baseline: what is failing once it can be read already was.
  if (!previous) return next.unreadable ? undefined : next;
  if (next.unreadable) return { ...previous, unreadable: next.unreadable };

  return {
    ...next,
    failing: new Map([...[...previous.failing].filter(([name]) => next.retrying.has(name)), ...next.failing]),
    settled: new Map([...previous.settled, ...next.settled]),
  };
};
