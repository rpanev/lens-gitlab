import { runStatusOf } from "./run-status";
import type { RunJob, RunStep } from "./run-jobs";

/** From when to when, in milliseconds. */
export interface TimeSpan {
  readonly start: number;
  readonly end: number;
}

interface Timed {
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

const at = (time: string | null | undefined) => (time ? new Date(time).getTime() : undefined);

/** From the first start to the last end of what is given, an unfinished one counting up to now. */
export const spanOf = (items: readonly Timed[], now = Date.now()): TimeSpan | undefined => {
  const starts = items.flatMap((item) => at(item.startedAt) ?? []);

  if (starts.length === 0) return undefined;

  const ends = items.flatMap((item) => (at(item.startedAt) === undefined ? [] : [at(item.completedAt) ?? now]));

  return { start: Math.min(...starts), end: Math.max(...ends) };
};

/** Where an item sits within a span, in percent of it: what a bar of a timeline is drawn from. */
export const barOf = (item: Timed, span: TimeSpan, now = Date.now()) => {
  const start = at(item.startedAt);

  if (start === undefined) return undefined;

  const length = Math.max(span.end - span.start, 1);
  const end = at(item.completedAt) ?? now;

  return {
    offset: ((start - span.start) / length) * 100,
    // At least a sliver, so a job of a second is still seen.
    width: Math.max(((end - start) / length) * 100, 0.5),
  };
};

/** The share each step of a job took of it, in percent, with its status: what a job's step bar is drawn from. */
export const stepSegmentsOf = (job: Pick<RunJob, "steps">, now = Date.now()) => {
  const steps = job.steps ?? [];
  const span = spanOf(steps, now);

  if (!span) return [];

  const length = Math.max(span.end - span.start, 1);

  // Steps that never started, as those after a failed one, take no share.
  return steps.flatMap((step: RunStep) => {
    const start = at(step.startedAt);

    return start === undefined
      ? []
      : [
          {
            step,
            share: Math.max((((at(step.completedAt) ?? now) - start) / length) * 100, 0.5),
            status: runStatusOf(step),
          },
        ];
  });
};

/** "6m 24s" for a span in milliseconds. */
export const formatSpan = (milliseconds: number) => {
  const total = Math.floor(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};
