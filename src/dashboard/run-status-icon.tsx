import { CheckCircleIcon, ErrorIcon, RemoveCircleOutlineIcon, ScheduleIcon, WarningIcon } from "@k8slens/icon";
import { inProgress, type RunStatus } from "../workflow-runs/run-status";
import { RunningIcon } from "./running-icon";

export const RunStatusIcon = ({ status }: { status: RunStatus }) => {
  switch (status.color) {
    case "success":
      return <CheckCircleIcon $size="s" $color="success" />;
    case "critical":
      return <ErrorIcon $size="s" $color="critical" />;
    case "warning":
      return <WarningIcon $size="s" $color="warning" />;
    case "primary":
      // Queued waits; in progress turns, as GitHub shows it.
      return status === inProgress ? <RunningIcon /> : <ScheduleIcon $size="s" $color="primary" />;
    case "grey60":
      return <RemoveCircleOutlineIcon $size="s" $color="textMuted" />;
  }
};
