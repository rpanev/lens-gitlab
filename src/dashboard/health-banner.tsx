import { Button, Div, Span } from "@k8slens/element-components";
import {
  CheckCircleIcon,
  ErrorIcon,
  RemoveCircleOutlineIcon,
  ScheduleIcon,
  SettingsIcon,
  WarningIcon,
} from "@k8slens/icon";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import type { DashboardHealth } from "./dashboard-health.injectable";
import { dashboardHealthInjectable } from "./dashboard-health.injectable";

type Color = "success" | "critical" | "notice" | "primary" | "grey60";

const looks: Record<DashboardHealth["state"], { label: string; color: Color }> = {
  checking: { label: "Checking", color: "grey60" },
  unreachable: { label: "Unreachable", color: "notice" },
  failing: { label: "Failing", color: "critical" },
  deploying: { label: "Deploying", color: "primary" },
  behind: { label: "Behind", color: "notice" },
  "up-to-date": { label: "Up to date", color: "success" },
  "nothing-deployed": { label: "Not deployed", color: "grey60" },
};

const HealthIcon = ({ state }: { state: DashboardHealth["state"] }) => {
  switch (state) {
    case "up-to-date":
      return <CheckCircleIcon $size="m" $color="success" />;
    case "failing":
      return <ErrorIcon $size="m" $color="critical" />;
    case "behind":
    case "unreachable":
      return <WarningIcon $size="m" $color="notice" />;
    case "deploying":
      return <ScheduleIcon $size="m" $color="primary" />;
    default:
      return <RemoveCircleOutlineIcon $size="m" $color="textMuted" />;
  }
};

interface HealthBannerProps {
  readonly clusterId: string;
  readonly aside: string;
  readonly onSettings: () => void;
}

export const HealthBanner = observer(({ clusterId, aside, onSettings }: HealthBannerProps) => {
  const health = useInject(dashboardHealthInjectable)(clusterId).get();
  const { label, color } = looks[health.state];

  return (
    <Div
      $flex={{ direction: "horizontal", gap: "m", verticalAlign: "center" }}
      $padding={{ horizontal: "xl", vertical: "l" }}
      $border={{ left: { width: "xs", color }, bottom: { width: "xxs", color: "grey60" } }}
    >
      <HealthIcon state={health.state} />
      <Span $color={color === "grey60" ? "textMuted" : color}>{label}</Span>
      <Span $flexChild>{health.message}</Span>
      <Span $color="textMuted">{aside}</Span>
      <Button $onClick={onSettings} $tooltip="GitLabOps settings" $interactive>
        <SettingsIcon $size="s" />
      </Button>
    </Div>
  );
});
