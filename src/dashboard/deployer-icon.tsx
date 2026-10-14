import { CheckCircleIcon, ErrorIcon, ScheduleIcon } from "@k8slens/icon";
import type { DeployResource } from "../deployments/cluster-images";

export const DeployerIcon = ({ state }: { state: DeployResource["state"] }) => {
  switch (state) {
    case "ready":
      return <CheckCircleIcon $size="s" $color="success" />;
    case "reconciling":
      return <ScheduleIcon $size="s" $color="primary" />;
    case "failed":
      return <ErrorIcon $size="s" $color="critical" />;
  }
};
