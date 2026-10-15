import { CheckCircleIcon, ErrorIcon, ScheduleIcon, WarningIcon } from "@k8slens/icon";
import { A, Code, Div, getTooltipProps, Span } from "@k8slens/element-components";
import {
  getTableColumnInjectableBunch,
  getTableInjectableBunch,
  getTableKind,
  type TableColumnCellProps,
} from "@k8slens/table-contracts";
import { useInject } from "@k8slens/use-inject";
import type { Workload } from "../deployments/cluster-images";
import { openVersionInjectable } from "../pipelines/open-version.injectable";
import { isReleasesWatch, watchOfKey } from "../watched-repositories/watched-repository";
import { type ServiceRow, serviceLookOf, serviceStatusOf } from "./flux-stage";
import { columnHeader, getWatchRowsBunch, type WatchTableParams } from "./watch-table";
import { ServiceTooltip } from "./service-tooltip";
import { DeployerLink } from "./deployer-link";
import { DetailsLink } from "./details-link";

/** A service with the cluster it runs in, which is what opening its details asks for. */
interface Row extends ServiceRow {
  readonly clusterId: string;
}

export const servicesTableKind = getTableKind<Row, WatchTableParams>("lens-gitlab-services");

export const servicesBunch = getWatchRowsBunch<Row>("services", (watchState, clusterId, watchKey) => {
  const unit = isReleasesWatch(watchOfKey(watchKey)) ? "release" : "commit";

  return watchState.summary?.services.map((service) => ({ ...service, unit, clusterId }));
});

export const servicesTable = getTableInjectableBunch({
  kind: servicesTableKind,
  getRowId: (service) => service.name,
  data: {
    instantiate: (di) => {
      const servicesOf = di.inject(servicesBunch.subscribable);

      return (...params) => servicesOf(...params);
    },
  },
});

type CellProps = TableColumnCellProps<Row>;

const StatusIcon = ({ row }: CellProps) => {
  switch (serviceLookOf(row)) {
    case "failed":
      return <ErrorIcon $size="s" $color="critical" />;
    case "progressing":
      return <ScheduleIcon $size="s" $color="primary" />;
    case "behind":
      return <WarningIcon $size="s" $color="notice" />;
    case "latest":
      return <CheckCircleIcon $size="s" $color="success" />;
  }
};

// The status leads the name: a column of its own would take a share of the width as wide as any other.
const NameCell = ({ row }: CellProps) => {
  const [workload] = row.workloads;

  return (
    <Div
      $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}
      $tooltip={getTooltipProps({ Content: ServiceTooltip, contentProps: { service: row } })}
    >
      <StatusIcon row={row} />
      {workload ? (
        <DetailsLink clusterId={row.clusterId} resource={workload}>
          {row.name}
        </DetailsLink>
      ) : (
        <Span>{row.name}</Span>
      )}
    </Div>
  );
};

const VersionCell = ({ row }: CellProps) => {
  const openVersion = useInject(openVersionInjectable)();

  if (!row.running) return <Code>—</Code>;

  return (
    <A onClick={() => void openVersion(row.running!)} $tooltip="Open on GitLab" $color="link">
      <Code>{row.running.label}</Code>
    </A>
  );
};

const StateCell = ({ row }: CellProps) => (
  <Span $color={serviceLookOf(row) === "failed" ? "critical" : undefined}>{serviceStatusOf(row)}</Span>
);

const DeployerCell = ({ row }: CellProps) => (
  <DeployerLink clusterId={row.clusterId} deployer={row.deployer} chart={row.chart?.applied} />
);

const workloadKindsOf = (workloads: readonly Workload[]) => {
  const counts = new Map<string, number>();

  for (const workload of workloads) counts.set(workload.kind, (counts.get(workload.kind) ?? 0) + 1);

  return [...counts].map(([kind, count]) => (count > 1 ? `${kind} ×${count}` : kind)).join(", ");
};

const WorkloadsCell = ({ row }: CellProps) => (
  <Span $tooltip={getTooltipProps({ Content: ServiceTooltip, contentProps: { service: row } })}>
    {workloadKindsOf(row.workloads) || "—"}
  </Span>
);

const columns = [
  ["service-name", NameCell, columnHeader("Service")],
  ["service-commit", VersionCell, columnHeader("Version")],
  ["service-state", StateCell, columnHeader("Status")],
  ["service-flux", DeployerCell, columnHeader("Deployed by")],
  ["service-workloads", WorkloadsCell, columnHeader("Workloads")],
] as const;

export const [
  serviceNameColumn,
  serviceVersionColumn,
  serviceStateColumn,
  serviceDeployerColumn,
  serviceWorkloadsColumn,
] = columns.map(([id, Cell, Header], index) =>
  getTableColumnInjectableBunch({
    id: `lens-gitlab-${id}`,
    kind: servicesTableKind,
    orderNumber: (index + 1) * 10,
    Cell,
    Header,
  }),
);
