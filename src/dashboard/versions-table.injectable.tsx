import { type $TooltipProps, A, Code, Div, getTooltipProps, Span } from "@k8slens/element-components";
import type { ReactNode } from "react";
import {
  getTableColumnInjectableBunch,
  getTableInjectableBunch,
  getTableKind,
  type TableColumnCellProps,
} from "@k8slens/table-contracts";
import { useInject } from "@k8slens/use-inject";
import { entriesOfVersion, type VersionEntry } from "../deployments/version-entries";
import { isReleasesWatch, watchOfKey } from "../watched-repositories/watched-repository";
import { overallStatusOf } from "../workflow-runs/run-status";
import { CommitRunsTooltip } from "./commit-runs-tooltip";
import { formatAge } from "./format-time-ago";
import { RunStatusIcon } from "./run-status-icon";
import { ServiceTooltip } from "./service-tooltip";
import { EntryDot } from "./entry-dot";
import { selectedVersionInjectable } from "./selected-version.injectable";
import type { VersionRow } from "./watch-on-cluster.injectable";
import { columnHeader, getWatchRowsBunch, type WatchTableParams } from "./watch-table";

/** A row with what its services are counted in, as the tooltips say it. */
interface Row extends VersionRow {
  readonly unit: "commit" | "release";
  readonly clusterId: string;
  readonly watchKey: string;
}

export const versionsTableKind = getTableKind<Row, WatchTableParams>("lens-gitlab-versions");

export const versionRowsBunch = getWatchRowsBunch<Row>("version-rows", (watchState, clusterId, watchKey) => {
  const unit = isReleasesWatch(watchOfKey(watchKey)) ? "release" : "commit";

  return watchState.activity.status === "loading"
    ? undefined
    : watchState.rows.map((row) => ({ ...row, unit, clusterId, watchKey }));
});

export const versionsTable = getTableInjectableBunch({
  kind: versionsTableKind,
  getRowId: (row) => row.version.id,
  data: {
    instantiate: (di) => {
      const versionRowsOf = di.inject(versionRowsBunch.subscribable);

      return (...params) => versionRowsOf(...params);
    },
  },
});

type CellProps = TableColumnCellProps<Row>;

const runsTooltip = (row: Row) =>
  getTooltipProps({
    Content: CommitRunsTooltip,
    contentProps: { runs: row.runs, runsOn: row.runsOn, others: row.otherRuns.length },
  });

/** Opens the version's details panel over the dashboard. */
const SelectLink = ({
  row,
  tooltip,
  children,
}: {
  row: Row;
  tooltip: string | $TooltipProps<any>;
  children: ReactNode;
}) => {
  const selected = useInject(selectedVersionInjectable)(row.clusterId);

  return (
    <A
      onClick={() => selected.select({ watchKey: row.watchKey, versionId: row.version.id })}
      $tooltip={tooltip}
      $color="link"
    >
      {children}
    </A>
  );
};

// The CI status leads the version: a column of its own would take a share of the width as wide as any other.
const VersionCell = ({ row }: CellProps) => (
  <Div $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}>
    {row.runs.length > 0 && (
      <Div $tooltip={runsTooltip(row)}>
        <RunStatusIcon status={overallStatusOf(row.runs)} />
      </Div>
    )}
    <SelectLink row={row} tooltip={row.version.prerelease ? "Pre-release · show its details" : "Show its details"}>
      <Code>{row.version.label}</Code>
    </SelectLink>
  </Div>
);

const TitleCell = ({ row }: CellProps) =>
  row.version.title !== row.version.label ? <Span $tooltip={row.version.title}>{row.version.title}</Span> : null;

const ChecksCell = ({ row }: CellProps) => {
  if (row.runs.length === 0 && row.otherRuns.length === 0) return <Span $color="textMuted">—</Span>;

  const others = row.otherRuns.length;

  return (
    <SelectLink row={row} tooltip={runsTooltip(row)}>
      {/* Only what the version started counts; GitHub's own runs recorded against it do not. */}
      {row.runs.length > 0
        ? `${row.runs.filter((run) => run.conclusion === "success").length}/${row.runs.length} passed`
        : `${others} other ${others === 1 ? "run" : "runs"}`}
      {row.runsOn && <Span $color="textMuted"> · on {row.runsOn}</Span>}
    </SelectLink>
  );
};

const EntriesTooltip = ({ entries }: { entries: readonly VersionEntry[] }) => (
  <Div $flex={{ direction: "vertical", gap: "xs" }}>
    {entries.map((entry) => (
      <Div key={`${entry.label}:${entry.name}`} $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}>
        <EntryDot entry={entry} />
        <Span $color="textMuted">{entry.label}</Span>
      </Div>
    ))}
  </Div>
);

// One line, as every row of a table is: the first service, Kustomization or Application, and how many more, all of them on hover.
const InClusterCell = ({ row }: CellProps) => {
  const entries = entriesOfVersion(row.services, row.syncs);
  const [first, ...others] = entries;
  const [onlyService] = row.services ?? [];

  if (!first) return null;

  return (
    <Div
      $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}
      $tooltip={
        others.length === 0 && onlyService
          ? getTooltipProps({
              Content: ServiceTooltip,
              contentProps: { service: { ...onlyService.service, unit: row.unit } },
            })
          : getTooltipProps({ Content: EntriesTooltip, contentProps: { entries } })
      }
    >
      <EntryDot entry={first} />
      {others.length > 0 && <Span $color="textMuted">+{others.length} more</Span>}
    </Div>
  );
};

const AgeCell = ({ row }: CellProps) => <Span>{formatAge(row.version.at)}</Span>;

const columns = [
  ["version", VersionCell, columnHeader("Version")],
  ["title", TitleCell, columnHeader("Message")],
  ["checks", ChecksCell, columnHeader("Workflows")],
  ["in-cluster", InClusterCell, columnHeader("In cluster")],
  ["age", AgeCell, columnHeader("Age")],
] as const;

export const [versionColumn, versionTitleColumn, versionChecksColumn, versionInClusterColumn, versionAgeColumn] =
  columns.map(([id, Cell, Header], index) =>
    getTableColumnInjectableBunch({
      id: `lens-gitlab-version-${id}`,
      kind: versionsTableKind,
      orderNumber: (index + 1) * 10,
      Cell,
      Header,
    }),
  );
