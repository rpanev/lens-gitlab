import { A, Code, Div, Span } from "@k8slens/element-components";
import { CheckCircleIcon, ErrorIcon, ScheduleIcon, WarningIcon } from "@k8slens/icon";
import {
  getTableColumnInjectableBunch,
  getTableInjectableBunch,
  getTableKind,
  type TableColumnCellProps,
} from "@k8slens/table-contracts";
import { useInject } from "@k8slens/use-inject";
import type { GitOpsSync } from "../deployments/gitops-syncs";
import { openResourceDetailsInjectable } from "../deployments/open-resource-details.injectable";
import { openVersionInjectable } from "../pipelines/open-version.injectable";
import { syncStatusOf } from "./flux-stage";
import { columnHeader, getWatchRowsBunch, type WatchTableParams } from "./watch-table";

/** A Kustomization or Application with the cluster it is in, which is what opening its details asks for. */
interface Row extends GitOpsSync {
  readonly clusterId: string;
}

// The ids keep their first names: Lens keeps the table's column settings by them.
export const gitOpsSyncsTableKind = getTableKind<Row, WatchTableParams>("lens-gitlab-flux-syncs");

export const gitOpsSyncsBunch = getWatchRowsBunch<Row>("gitops-syncs", (watchState, clusterId) =>
  watchState.summary?.syncs.map((sync) => ({ ...sync, clusterId })),
);

export const gitOpsSyncsTable = getTableInjectableBunch({
  kind: gitOpsSyncsTableKind,
  // A Kustomization and an Application can share a namespace and a name.
  getRowId: (row) => `${row.resource.kind}/${row.resource.namespace}/${row.resource.name}`,
  data: {
    instantiate: (di) => {
      const syncsOf = di.inject(gitOpsSyncsBunch.subscribable);

      return (...params) => syncsOf(...params);
    },
  },
});

type CellProps = TableColumnCellProps<Row>;

const StatusIcon = ({ row }: CellProps) => {
  if (row.pending?.stage === "failed") return <ErrorIcon $size="s" $color="critical" />;
  if (row.pending) return <ScheduleIcon $size="s" $color="primary" />;

  return row.applied?.behind === 0 ? (
    <CheckCircleIcon $size="s" $color="success" />
  ) : (
    <WarningIcon $size="s" $color="notice" />
  );
};

// The status leads the name: a column of its own would take a share of the width as wide as any other.
const NameCell = ({ row }: CellProps) => {
  const openResourceDetails = useInject(openResourceDetailsInjectable)();

  return (
    <Div $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}>
      <StatusIcon row={row} />
      <A onClick={() => void openResourceDetails(row.clusterId, row.resource)} $color="link">
        {row.resource.name}
      </A>
    </Div>
  );
};

const AppliedCell = ({ row }: CellProps) => {
  const openVersion = useInject(openVersionInjectable)();

  if (!row.applied) return <Code>—</Code>;

  return (
    <A onClick={() => void openVersion(row.applied!)} $tooltip="Open on GitLab" $color="link">
      <Code>{row.applied.label}</Code>
    </A>
  );
};

const StatusCell = ({ row }: CellProps) => (
  <Span
    $color={row.pending?.stage === "failed" ? "critical" : undefined}
    $tooltip={row.pending?.stage === "failed" ? row.resource.message : undefined}
  >
    {syncStatusOf(row)}
  </Span>
);

// A Kustomization applies a GitRepository of its own; an Application fetches its source itself.
const SourceCell = ({ row }: CellProps) => (
  <Span $color="textMuted">
    {row.resource.kind === "Application"
      ? `Argo CD Application ${row.resource.namespace}/${row.resource.name}`
      : `GitRepository ${row.source.namespace}/${row.source.name}`}
  </Span>
);

const columns = [
  ["name", NameCell, columnHeader("Applied by")],
  ["applied", AppliedCell, columnHeader("Applied")],
  ["status", StatusCell, columnHeader("Status")],
  ["source", SourceCell, columnHeader("Source")],
] as const;

export const [gitOpsSyncNameColumn, gitOpsSyncAppliedColumn, gitOpsSyncStatusColumn, gitOpsSyncSourceColumn] =
  columns.map(([id, Cell, Header], index) =>
    getTableColumnInjectableBunch({
      id: `lens-gitlab-flux-sync-${id}`,
      kind: gitOpsSyncsTableKind,
      orderNumber: (index + 1) * 10,
      Cell,
      Header,
    }),
  );
