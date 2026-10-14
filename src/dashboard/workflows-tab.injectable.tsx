import { Div, Span } from "@k8slens/element-components";
import { getInjectable2 } from "@k8slens/injectable";
import { mainViewTabHostKind } from "@k8slens/main-view-contracts";
import { getPersistableMapInjectableBunch } from "@k8slens/persistable-contracts";
import {
  focusTabInjectionToken,
  getTabKind,
  getTabKindInjectableBunch,
  openTabInjectionToken,
  type TabId,
  tabIsOpenInjectionToken,
  type TabProps,
} from "@k8slens/tab-contracts";
import { useInject, useSyncInject } from "@k8slens/use-inject";
import { computed, type ObservableMap, observable, runInAction } from "mobx";
import { observer } from "mobx-react";
import { useEffect } from "react";
import { hostOf, watchOfKey } from "../watched-repositories/watched-repository";
import { workflowsTitleOf } from "../workflow-runs/version";
import { GlabProblemNotice } from "./gh-problem-notice";
import { watchOnClusterInjectable } from "./watch-on-cluster.injectable";
import { WorkflowRunCards } from "./workflow-run-cards";

/** Which version's workflows a tab shows: the watch on the cluster it belongs to, and the version. */
export interface WorkflowsTabInput {
  readonly clusterId: string;
  readonly watchKey: string;
  readonly versionId: string;
  /** What names the version while the watch has not been read yet, as after a restart. */
  readonly label: string;
}

export const workflowsTabKind = getTabKind<WorkflowsTabInput>()("lens-gitlab-workflows");

// Lens keeps the tab across restarts; what it shows is the extension's to keep.
export const workflowsTabInputsBunch = getPersistableMapInjectableBunch<TabId, WorkflowsTabInput>()({
  id: "workflows-tab-inputs",
});

export const workflowsTabInputInjectable = getInjectable2({
  id: "lens-gitlab-workflows-tab-input",

  instantiate: (di) => {
    const getInputs = di.inject(workflowsTabInputsBunch.persistable);
    // Undefined until what was persisted has loaded.
    const inputs = observable.box<ObservableMap<TabId, WorkflowsTabInput> | undefined>(undefined, { deep: false });

    void getInputs().then((loaded) => runInAction(() => inputs.set(loaded)));

    return (tabId: TabId) => computed(() => inputs.get()?.get(tabId));
  },
});

const tabIdOf = ({ clusterId, watchKey, versionId }: WorkflowsTabInput) =>
  JSON.stringify([clusterId, watchKey, versionId]);

export const openWorkflowsTabInjectable = getInjectable2({
  id: "lens-gitlab-open-workflows-tab",
  consumptions: [openTabInjectionToken, focusTabInjectionToken, tabIsOpenInjectionToken],

  instantiate: (di) => {
    const openTab = di.inject(openTabInjectionToken.for(mainViewTabHostKind).for(workflowsTabKind).for(di.scopeIds))();
    const focusTab = di.inject(
      focusTabInjectionToken.for(mainViewTabHostKind).for(workflowsTabKind).for(di.scopeIds),
    )();
    const isOpen = di.inject(tabIsOpenInjectionToken.for(mainViewTabHostKind).for(workflowsTabKind).for(di.scopeIds))();

    return () => async (input: WorkflowsTabInput) => {
      const tabId = tabIdOf(input);

      await ((await isOpen({ tabId })) ? focusTab({ tabId }) : openTab({ tabId, input }));
    };
  },
});

const WorkflowsTitle = observer(({ tabId }: TabProps<typeof mainViewTabHostKind>) => {
  const input = useSyncInject(workflowsTabInputInjectable, tabId).get();

  return <Div>Pipelines{input ? ` · ${input.label}` : ""}</Div>;
});

const WorkflowsOfVersion = observer(({ input }: { input: WorkflowsTabInput }) => {
  const watchState = useInject(watchOnClusterInjectable)(input.clusterId, input.watchKey);
  const row = watchState.rows.find((each) => each.version.id === input.versionId);
  const watch = watchOfKey(input.watchKey);
  const { repository } = watch;

  // The tab keeps the watch read while it is open, so a run in progress goes on updating.
  useEffect(() => watchState.watch(), [watchState]);

  return (
    <Div $flex={{ direction: "vertical", gap: "l" }} $padding="xxl" $height="full" $overflow={{ y: "auto" }}>
      <Span $font={{ size: "xl" }}>
        {repository} · {row ? workflowsTitleOf(row) : input.label}
      </Span>
      {row ? (
        <WorkflowRunCards
          host={hostOf(watch)}
          project={repository}
          row={row}
          onRerun={() => void watchState.refresh()}
          place={tabIdOf(input)}
        />
      ) : watchState.activity.status === "loading" ? (
        <Span $color="textMuted">Loading…</Span>
      ) : watchState.activity.status === "failed" ? (
        <GlabProblemNotice problem={watchState.activity.problem} hadData={false} />
      ) : (
        <Span $color="textMuted">{input.label} is no longer among the latest versions this watch shows.</Span>
      )}
    </Div>
  );
});

const Workflows = observer(({ tabId }: TabProps<typeof mainViewTabHostKind>) => {
  const input = useSyncInject(workflowsTabInputInjectable, tabId).get();

  return input ? <WorkflowsOfVersion input={input} /> : null;
});

export const workflowsTabBunch = getTabKindInjectableBunch({
  tabHostKind: mainViewTabHostKind,
  kind: workflowsTabKind,
  Component: Workflows,
  Title: WorkflowsTitle,

  onTabCreate: {
    instantiate: (di) => {
      const getInputs = di.inject(workflowsTabInputsBunch.persistable);

      return () =>
        async ({ tabId, input }) => {
          (await getInputs()).set(tabId, input);
        };
    },
  },
});
