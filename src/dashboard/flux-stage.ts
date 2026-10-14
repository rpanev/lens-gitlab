import type { GitOpsSync } from "../deployments/gitops-syncs";
import type { Service } from "../deployments/services";

/** A service with what its versions are called, which is what "behind" counts in. */
export interface ServiceRow extends Service {
  readonly unit: "commit" | "release";
}

/** What a service's status says, in words. */
export const serviceStatusOf = ({ running, rollingOut, pickedUp, chart, unit }: ServiceRow) => {
  if (pickedUp) {
    switch (pickedUp.stage) {
      case "selected":
        return `${pickedUp.label} selected by Flux`;
      case "committed":
        return `${pickedUp.label} committed by Flux`;
      case "applying":
        return `Flux applying ${pickedUp.label}`;
      case "failed":
        return `Flux failed to apply ${pickedUp.label}`;
    }
  }

  // A chart on its way is what changes next, such as a migration running, so it comes before the rollout it brings.
  switch (chart?.pending?.stage) {
    case "waiting":
      return `Chart ${chart.pending.version} waiting to install`;
    case "upgrading":
      return `Upgrading chart to ${chart.pending.version}`;
    case "failed":
      return `Chart ${chart.pending.version} failed to install`;
  }

  if (!running) return "Not running yet";
  if (rollingOut) return "Rolling out";

  return running.behind === 0 ? "Latest" : `${running.behind} ${unit}${running.behind === 1 ? "" : "s"} behind`;
};

export type ServiceLook = "failed" | "progressing" | "behind" | "latest";

export const serviceLookOf = (service: Service): ServiceLook => {
  if (
    service.deployer?.state === "failed" ||
    service.pickedUp?.stage === "failed" ||
    service.chart?.pending?.stage === "failed"
  )
    return "failed";
  if (service.rollingOut || service.pickedUp || service.chart?.pending || !service.running) return "progressing";

  return service.running.behind === 0 ? "latest" : "behind";
};

// A commit older than the versions watched is as far behind as can be told, and maybe more.
const behindLabel = ({ behind, at }: NonNullable<GitOpsSync["applied"]>) =>
  behind === 0 ? "Latest" : `${behind}${at ? "" : "+"} ${behind === 1 && at ? "commit" : "commits"} behind`;

export const syncStatusOf = ({ applied, pending }: GitOpsSync) => {
  switch (pending?.stage) {
    case "fetched":
      return `${pending.label} fetched, not applied yet`;
    case "applying":
      return `Applying ${pending.label}`;
    case "failed":
      return `Failed to apply ${pending.label}`;
  }

  return applied ? behindLabel(applied) : "Not applied yet";
};
