import { isStartedByVersion, type Pipeline } from "../pipelines/pipeline";

/** How long a week of deploys is counted over. */
export const doraWeekMs = 7 * 24 * 60 * 60 * 1000;
const keptMs = 90 * 24 * 60 * 60 * 1000;
const hotfixWindowMs = 24 * 60 * 60 * 1000;

export type DoraVia = "flux" | "argo";
export type DoraFailure = "rollout" | "apply" | "rollback" | "hotfix";

/** One deploy of one target, remembered so a later deploy does not erase it. */
export interface DoraDeploy {
  readonly id: string;
  readonly repository: string;
  readonly target: string;
  readonly via: DoraVia;
  readonly versionId: string;
  readonly versionLabel: string;
  readonly versionTitle?: string;
  readonly committedAt: string;
  readonly ciFinishedAt?: string;
  readonly appliedAt?: string;
  readonly runningAt?: string;
  /** The running time is when the ReplicaSet was created, not when the rollout finished. */
  readonly approximate?: boolean;
  readonly failed: boolean;
  readonly failure?: DoraFailure;
  /** An unplanned deploy made because a production change failed: a rollback or a hotfix. */
  readonly rework?: boolean;
}

export interface LeadStage {
  readonly name: "CI" | "Flux" | "Argo CD" | "rollout";
  readonly ms: number;
}

const at = (time?: string) => (time ? Date.parse(time) : undefined);

const after = (from?: string, to?: string) => {
  const start = at(from);
  const end = at(to);

  if (start === undefined || end === undefined || end < start) return undefined;

  return end - start;
};

/** When the pipelines the version started had finished successfully: the image exists. */
export const ciFinishedAtOf = (runs: readonly Pipeline[]) => {
  const finished = runs.flatMap((run) =>
    isStartedByVersion(run) && run.conclusion === "success" && run.finishedAt ? [run.finishedAt] : [],
  );

  return finished.sort().at(-1);
};

export const deployIdOf = (repository: string, target: string, versionId: string) =>
  `${repository}\n${target}\n${versionId}`;

export const deployOf = (fields: Omit<DoraDeploy, "id">): DoraDeploy => ({
  id: deployIdOf(fields.repository, fields.target, fields.versionId),
  repository: fields.repository,
  target: fields.target,
  via: fields.via,
  versionId: fields.versionId,
  versionLabel: fields.versionLabel,
  versionTitle: fields.versionTitle,
  committedAt: fields.committedAt,
  ciFinishedAt: fields.ciFinishedAt,
  appliedAt: fields.appliedAt,
  runningAt: fields.runningAt,
  approximate: fields.approximate,
  failed: fields.failed,
  failure: fields.failure,
  rework: fields.rework,
});

/**
 * commit → image (CI), image → applied (Flux or Argo CD), applied → running (rollout).
 * Once CI's end is known, the controller stage starts there, so pipeline time is not called Flux.
 */
export const leadStagesOf = (deploy: DoraDeploy): LeadStage[] => {
  const controller: LeadStage["name"] = deploy.via === "argo" ? "Argo CD" : "Flux";
  const stages: LeadStage[] = [];
  const ci = after(deploy.committedAt, deploy.ciFinishedAt);

  if (ci !== undefined) stages.push({ name: "CI", ms: ci });

  const applied = after(deploy.ciFinishedAt ?? deploy.committedAt, deploy.appliedAt);

  if (applied !== undefined) stages.push({ name: controller, ms: applied });

  const rolloutFrom = deploy.appliedAt ?? deploy.ciFinishedAt;
  const rolloutTo = deploy.runningAt && deploy.runningAt !== deploy.appliedAt ? deploy.runningAt : undefined;
  const rollout = after(rolloutFrom, rolloutTo);

  if (rollout !== undefined) stages.push({ name: "rollout", ms: rollout });

  return stages;
};

/** Commit to running, when both times are known. */
export const leadTimeOf = (deploy: DoraDeploy) => after(deploy.committedAt, deploy.runningAt);

export const formatDuration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);

  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

/** "commit ──CI 12m──► image ──Flux 3m──► applied ──rollout 3m──► running", for the stages that have times. */
export const leadLineOf = (deploy: DoraDeploy) => {
  const stages = leadStagesOf(deploy);

  if (stages.length === 0) return undefined;

  const node: Record<LeadStage["name"], string> = { CI: "image", Flux: "applied", "Argo CD": "applied", rollout: "running" };

  return stages.reduce((line, stage) => `${line} ──${stage.name} ${formatDuration(stage.ms)}──► ${node[stage.name]}`, "commit");
};

const median = (values: readonly number[]) => {
  if (values.length === 0) return undefined;

  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const finishedThisWeek = (deploy: DoraDeploy, now: number) => {
  const running = at(deploy.runningAt);

  return running !== undefined && running >= now - doraWeekMs;
};

/** Median commit → running of deploys that reached running this week. */
export const medianLeadTimeOf = (deploys: readonly DoraDeploy[], now: number) =>
  median(
    deploys.flatMap((deploy) => {
      const lead = leadTimeOf(deploy);

      return finishedThisWeek(deploy, now) && lead !== undefined ? [lead] : [];
    }),
  );

/** How many deploys a day that count is, over the week. */
export const deploysPerDayOf = (total: number) => (total > 0 ? total / 7 : undefined);

const seenAt = (deploy: DoraDeploy) => at(deploy.runningAt) ?? at(deploy.appliedAt) ?? at(deploy.committedAt) ?? 0;

/** Median length of one stage, for deploys that reached running this week. */
export const medianStageOf = (deploys: readonly DoraDeploy[], now: number, name: LeadStage["name"]) =>
  median(
    deploys.flatMap((deploy) => {
      if (!finishedThisWeek(deploy, now)) return [];

      const stage = leadStagesOf(deploy).find((each) => each.name === name);

      return stage ? [stage.ms] : [];
    }),
  );

/**
 * Failed deployment recovery time: the median from a deploy that needed intervention
 * to the next deploy of the same target that reached the cluster.
 * Counted when the failure or the recovery is inside the week.
 */
export const medianRestoreOf = (deploys: readonly DoraDeploy[], now: number) => {
  const byTarget = new Map<string, DoraDeploy[]>();

  for (const deploy of deploys) {
    const key = `${deploy.repository}\n${deploy.target}`;

    byTarget.set(key, [...(byTarget.get(key) ?? []), deploy]);
  }

  const gaps: number[] = [];

  for (const group of byTarget.values()) {
    const ordered = [...group].sort((left, right) => seenAt(left) - seenAt(right));

    for (let index = 0; index < ordered.length; index++) {
      const failed = ordered[index];

      if (!failed?.failed) continue;

      const broke = seenAt(failed);
      const next = ordered.slice(index + 1).find((each) => !each.failed && (each.runningAt || each.appliedAt));
      const restored = at(next?.runningAt) ?? at(next?.appliedAt);

      if (restored === undefined || restored < broke) continue;
      if (restored < now - doraWeekMs && broke < now - doraWeekMs) continue;

      gaps.push(restored - broke);
    }
  }

  return median(gaps);
};

export interface ChangeFailure {
  readonly failed: number;
  readonly total: number;
  readonly rate?: number;
}

const countedAt = (deploy: DoraDeploy) => at(deploy.runningAt) ?? at(deploy.appliedAt);

/** Deploys that count this week: they reached the cluster, failed, or were unplanned rework. */
const weekDeploysOf = (deploys: readonly DoraDeploy[], now: number) =>
  deploys.filter((deploy) => {
    const when = countedAt(deploy) ?? (deploy.failed || deploy.rework ? at(deploy.committedAt) : undefined);

    return when !== undefined && when >= now - doraWeekMs && (deploy.runningAt || deploy.appliedAt || deploy.failed || deploy.rework);
  });

/**
 * Change fail rate: the share of this week's deploys that needed immediate intervention.
 * A stalled rollout, a failed apply, a change that was rolled back, or one a hotfix replaced.
 */
export const changeFailureOf = (deploys: readonly DoraDeploy[], now: number): ChangeFailure => {
  const week = weekDeploysOf(deploys, now);
  const failed = week.filter((deploy) => deploy.failed).length;

  return { failed, total: week.length, rate: week.length > 0 ? failed / week.length : undefined };
};

export interface DeploymentRework {
  readonly rework: number;
  readonly total: number;
  readonly rate?: number;
}

/**
 * Deployment rework rate: the share of this week's deploys that were unplanned,
 * a rollback or a hotfix made because of a failure in production.
 */
export const deploymentReworkOf = (deploys: readonly DoraDeploy[], now: number): DeploymentRework => {
  const week = weekDeploysOf(deploys, now);
  const rework = week.filter((deploy) => deploy.rework).length;

  return { rework, total: week.length, rate: week.length > 0 ? rework / week.length : undefined };
};

const mergeDeploy = (previous: DoraDeploy | undefined, next: DoraDeploy): DoraDeploy => {
  if (!previous) return next;

  const upgraded = !next.approximate && !!next.runningAt;
  const runningAt = upgraded ? next.runningAt : (previous.runningAt ?? next.runningAt);

  return {
    ...next,
    ciFinishedAt: previous.ciFinishedAt ?? next.ciFinishedAt,
    appliedAt: previous.appliedAt ?? next.appliedAt,
    runningAt,
    approximate: runningAt === next.runningAt ? next.approximate : previous.approximate,
    failed: next.failed,
    failure: next.failed ? next.failure : undefined,
  };
};

/** A newer commit replaced by an older one on the same target was rolled back. */
export const withRollbacks = (deploys: readonly DoraDeploy[]): DoraDeploy[] => {
  const byTarget = new Map<string, DoraDeploy[]>();

  for (const deploy of deploys) {
    const key = `${deploy.repository}\n${deploy.target}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), deploy]);
  }

  const rolledBack = new Set<string>();
  const rework = new Set<string>();

  for (const group of byTarget.values()) {
    const ordered = [...group].sort((left, right) => seenAt(left) - seenAt(right));

    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1];
      const current = ordered[index];

      if (current.committedAt < previous.committedAt) {
        rolledBack.add(previous.id);
        rework.add(current.id);
      }
    }
  }

  return deploys.map((deploy) => ({
    ...deploy,
    rework: rework.has(deploy.id) || undefined,
    ...(rolledBack.has(deploy.id) ? { failed: true, failure: deploy.failure ?? "rollback" } : {}),
  }));
};

const isHotfix = (title?: string) => !!title && /\b(hotfix|revert)\b/i.test(title);

/** The deploy before a hotfix or a revert, when the fix landed within a day. The fix itself is rework. */
export const withHotfixes = (deploys: readonly DoraDeploy[]): DoraDeploy[] => {
  const blamed = new Set<string>();
  const rework = new Set<string>();

  for (const fix of deploys) {
    if (!isHotfix(fix.versionTitle)) continue;

    rework.add(fix.id);

    const previous = deploys
      .filter(
        (deploy) =>
          deploy.repository === fix.repository &&
          deploy.target === fix.target &&
          deploy.id !== fix.id &&
          deploy.committedAt < fix.committedAt,
      )
      .sort((left, right) => seenAt(right) - seenAt(left))[0];
    const running = at(previous?.runningAt);

    if (previous && running !== undefined && at(fix.committedAt)! - running <= hotfixWindowMs) blamed.add(previous.id);
  }

  return deploys.map((deploy) => ({
    ...deploy,
    ...(deploy.rework || rework.has(deploy.id) ? { rework: true } : {}),
    ...(blamed.has(deploy.id) ? { failed: true, failure: deploy.failure ?? "hotfix" } : {}),
  }));
};

/** Incoming observations folded into what was remembered, then rollbacks and hotfixes, dropping what is older than 90 days. */
export const rememberDeploys = (
  stored: readonly DoraDeploy[],
  incoming: readonly DoraDeploy[],
  now: number,
): DoraDeploy[] => {
  const byId = new Map(stored.map((deploy) => [deploy.id, deploy]));

  for (const next of incoming) byId.set(next.id, mergeDeploy(byId.get(next.id), next));

  return withHotfixes(withRollbacks([...byId.values()]))
    .filter((deploy) => {
      const committed = at(deploy.committedAt);

      return committed !== undefined && now - committed < keptMs;
    })
    .sort((left, right) => left.committedAt.localeCompare(right.committedAt))
    .slice(-300);
};

/** The newest deploy that reached running, which is the one whose stages are shown. */
export const latestRunningOf = (deploys: readonly DoraDeploy[]) =>
  deploys
    .filter((deploy) => deploy.runningAt && leadStagesOf(deploy).length > 0)
    .sort((left, right) => seenAt(right) - seenAt(left))[0];
