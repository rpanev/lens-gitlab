import { A, Div, Span } from "@k8slens/element-components";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { hostOf, isReleasesWatch, type WatchedRepository, watchKeyOf } from "../watched-repositories/watched-repository";
import { mergeStandingOf, projectUrlOf } from "../workflow-runs/latest-merge-request";
import { openVersionInjectable } from "../workflow-runs/open-version.injectable";
import { watchOnClusterInjectable } from "./watch-on-cluster.injectable";
import { Panel } from "./panel";

const ProjectCard = observer(({ clusterId, watch }: { clusterId: string; watch: WatchedRepository }) => {
  const activity = useInject(watchOnClusterInjectable)(clusterId, watchKeyOf(watch)).activity;
  const openPage = useInject(openVersionInjectable)();
  const releases = isReleasesWatch(watch);
  const standing =
    !releases && activity.status === "loaded"
      ? mergeStandingOf(
          activity.mergeRequest,
          activity.recent.map((row) => ({ id: row.version.id, title: row.version.title, runs: row.runs })),
        )
      : undefined;
  const projectUrl = projectUrlOf(hostOf(watch), watch.repository);
  const text = releases
    ? "Releases"
    : activity.status === "loading"
      ? "Checking"
      : activity.status === "failed"
        ? "Unreachable"
        : (standing?.text ?? "Checking");
  const color = releases
    ? "textMuted"
    : activity.status === "failed"
      ? "critical"
      : (standing?.color ?? "textMuted");

  return (
    <Panel $flexChild $style={{ minWidth: "16rem" }}>
      <Span $color="textMuted" $style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {watch.repository}
      </Span>
      <Span $font={{ size: "xxl" }} $color={color} $tooltip={standing?.detail}>
        {text}
      </Span>
      <Span $color="textMuted">{releases ? "latest release" : `into ${watch.branch}`}</Span>
      {standing?.failed && projectUrl && (
        <A onClick={() => void openPage({ url: projectUrl })} $color="link">
          Open repository
        </A>
      )}
    </Panel>
  );
});

/** One card per watched project: whether the latest merge into its branch passed. */
export const ProjectSummaries = ({
  clusterId,
  watches,
}: {
  clusterId: string;
  watches: readonly WatchedRepository[];
}) => (
  <Div $flex={{ direction: "horizontal", gap: "xl", wrap: true }}>
    {watches.map((watch) => (
      <ProjectCard key={watchKeyOf(watch)} clusterId={clusterId} watch={watch} />
    ))}
  </Div>
);
