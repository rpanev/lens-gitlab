import type { WorkflowRun } from "./workflow-run";

export interface RunStatus {
  readonly label: string;
  readonly color: "success" | "critical" | "warning" | "primary" | "grey60";
  /** How much it asks for attention; a commit shows the most pressing status of its runs. */
  readonly severity: number;
}

export const inProgress: RunStatus = { label: "In progress", color: "primary", severity: 4 };
const queued: RunStatus = { label: "Queued", color: "primary", severity: 4 };
const failed: RunStatus = { label: "Failed", color: "critical", severity: 3 };
const timedOut: RunStatus = { label: "Timed out", color: "critical", severity: 3 };
const actionRequired: RunStatus = { label: "Action required", color: "warning", severity: 2 };
const success: RunStatus = { label: "Success", color: "success", severity: 1 };
const cancelled: RunStatus = { label: "Cancelled", color: "grey60", severity: 0 };
const skipped: RunStatus = { label: "Skipped", color: "grey60", severity: 0 };

/** What a status is read from: a workflow run, one of its jobs or one of their steps, which read the same. */
interface Ran {
  readonly status: string;
  /** None until it has finished, for a job or a step. */
  readonly conclusion?: string | null;
}

/** The status of a workflow run, or of one of its jobs or steps. */
export const runStatusOf = ({ status, conclusion }: Ran): RunStatus => {
  if (status !== "completed") return status === "in_progress" ? inProgress : queued;

  switch (conclusion) {
    case "success":
      return success;
    case "failure":
    case "startup_failure":
      return failed;
    case "timed_out":
      return timedOut;
    case "action_required":
      return actionRequired;
    case "cancelled":
      return cancelled;
    default:
      return skipped;
  }
};

export const overallStatusOf = (runs: readonly WorkflowRun[]): RunStatus =>
  runs.map(runStatusOf).reduce((worst, each) => (each.severity > worst.severity ? each : worst));

/** Whether a workflow's card starts open: folded once nothing in it asks for attention. */
export const opensByDefault = ({ status, conclusion }: Ran) =>
  !(status === "completed" && (conclusion === "success" || conclusion === "skipped"));
