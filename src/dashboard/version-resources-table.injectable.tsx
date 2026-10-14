import { Span } from "@k8slens/element-components";
import {
  getTableColumnInjectableBunch,
  getTableInjectableBunch,
  getTableKind,
  type TableColumnCellProps,
} from "@k8slens/table-contracts";
import type { VersionService } from "../deployments/version-services";
import { resourcesOfVersion, type VersionResource } from "../deployments/version-resources";
import { DeployerLink } from "./deployer-link";
import { DetailsLink } from "./details-link";
import { formatAge } from "./format-time-ago";
import { columnHeader, getWatchRowsBunch, type WatchTableParams } from "./watch-table";

/** What the cluster runs of one version: the table in its details panel. */
type Params = [...WatchTableParams, versionId: string];

interface Row extends VersionResource {
  readonly clusterId: string;
}

export const versionResourcesTableKind = getTableKind<Row, Params>("lens-gitlab-version-resources");

export const versionResourcesBunch = getWatchRowsBunch<Row, Params>(
  "version-resources",
  (watchState, clusterId, _watchKey, versionId) => {
    const row = watchState.rows.find((each) => each.version.id === versionId);

    // Undefined while the cluster is still being read.
    if (!row?.services) return row ? undefined : [];

    return resourcesOfVersion(row.services, row.syncs).map((resource) => ({ ...resource, clusterId }));
  },
);

export const versionResourcesTable = getTableInjectableBunch({
  kind: versionResourcesTableKind,
  getRowId: (row) => row.id,
  data: {
    instantiate: (di) => {
      const resourcesOf = di.inject(versionResourcesBunch.subscribable);

      return (...params) => resourcesOf(...params);
    },
  },
});

type CellProps = TableColumnCellProps<Row>;

const stateColors: Record<VersionService["state"], "success" | "primary" | "notice" | "critical"> = {
  running: "success",
  "rolling-out": "primary",
  "picked-up": "notice",
  failed: "critical",
};

const NameCell = ({ row }: CellProps) => (
  <Span $tooltip={`${row.resource.kind} ${row.namespace}/${row.resource.name}`}>
    <DetailsLink clusterId={row.clusterId} resource={row.resource}>
      {row.name}
    </DetailsLink>
  </Span>
);

const NamespaceCell = ({ row }: CellProps) => <Span>{row.namespace}</Span>;

const PodsCell = ({ row }: CellProps) =>
  row.pods ? (
    <Span $color={row.pods.ready < row.pods.desired ? "notice" : undefined}>
      {row.pods.ready}/{row.pods.desired}
    </Span>
  ) : (
    <Span $color="textMuted">—</Span>
  );

// A rollout, a scale or a replica coming back each start it again: a Deployment records it, and for a
// StatefulSet or a DaemonSet it is when the last of its pods became Ready.
const StableForCell = ({ row }: CellProps) =>
  row.settledAt ? (
    <Span $tooltip={`Settled ${new Date(row.settledAt).toLocaleString()}`}>{formatAge(row.settledAt)}</Span>
  ) : (
    <Span $color="textMuted">—</Span>
  );

const StatusCell = ({ row }: CellProps) => <Span $color={stateColors[row.state]}>{row.label}</Span>;

const DeployedByCell = ({ row }: CellProps) => (
  <DeployerLink clusterId={row.clusterId} deployer={row.deployer} chart={row.chart} />
);

const columns = [
  ["name", NameCell, columnHeader("Name")],
  ["namespace", NamespaceCell, columnHeader("Namespace")],
  ["pods", PodsCell, columnHeader("Pods")],
  ["stable-for", StableForCell, columnHeader("Stable for")],
  ["status", StatusCell, columnHeader("Status")],
  ["deployed-by", DeployedByCell, columnHeader("Deployed by")],
] as const;

export const [
  versionResourceNameColumn,
  versionResourceNamespaceColumn,
  versionResourcePodsColumn,
  versionResourceStableForColumn,
  versionResourceStatusColumn,
  versionResourceDeployedByColumn,
] = columns.map(([id, Cell, Header], index) =>
  getTableColumnInjectableBunch({
    id: `lens-gitlab-version-resource-${id}`,
    kind: versionResourcesTableKind,
    orderNumber: (index + 1) * 10,
    Cell,
    Header,
  }),
);
