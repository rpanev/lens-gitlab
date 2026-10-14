import { A } from "@k8slens/element-components";
import { useInject } from "@k8slens/use-inject";
import type { ReactNode } from "react";
import type { DeployResource, Workload } from "../deployments/cluster-images";
import { openResourceDetailsInjectable } from "../deployments/open-resource-details.injectable";

/** A link that opens a workload's, or what deploys it, details in the cluster's view. */
export const DetailsLink = ({
  clusterId,
  resource,
  children,
}: {
  clusterId: string;
  resource: Workload | DeployResource;
  children: ReactNode;
}) => {
  const openResourceDetails = useInject(openResourceDetailsInjectable)();

  return (
    <A onClick={() => void openResourceDetails(clusterId, resource)} $color="link">
      {children}
    </A>
  );
};
