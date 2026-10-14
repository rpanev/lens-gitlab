import { Div, Span } from "@k8slens/element-components";
import type { DeployResource } from "../deployments/cluster-images";
import { DeployerIcon } from "./deployer-icon";
import { DetailsLink } from "./details-link";

/** What applies a workload, Flux's or Argo CD's, with its state, a link to its details, and the chart it installed. */
export const DeployerLink = ({
  clusterId,
  deployer,
  chart,
}: {
  clusterId: string;
  deployer?: DeployResource;
  chart?: string;
}) =>
  deployer ? (
    <Div
      $flex={{ direction: "horizontal", gap: "xs", verticalAlign: "center" }}
      $tooltip={deployer.message ?? `${deployer.kind} ${deployer.namespace}/${deployer.name}`}
    >
      <DeployerIcon state={deployer.state} />
      <DetailsLink clusterId={clusterId} resource={deployer}>
        {deployer.kind} {deployer.name}
      </DetailsLink>
      {chart && <Span $color="textMuted">· chart {chart}</Span>}
    </Div>
  ) : (
    <Span $color="textMuted">—</Span>
  );
