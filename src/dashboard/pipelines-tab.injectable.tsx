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
import { pipelinesTitleOf } from "../pipelines/version";
import { GlabProblemNotice } from "./glab-problem-notice";
import { watchOnClusterInjectable } from "./watch-on-cluster.injectable";
import { PipelineCards } from "./pipeline-cards";

/** Which version's pipelines a tab shows: the watch on the cluster it belongs to, and the version. */
export interface PipelinesTabInput {
  readonly clusterId: string;
  readonly watchKey: string;
  readonly versionId: string;
  /** What names the version while the watch has not been read yet, as after a restart. */
  readonly label: string;
}

export const pipelinesTabKind = getTabKind<PipelinesTabInput>()("lens-gitlab-pipelines");

// Lens keeps the tab across restarts; what it shows is the extension's to keep.
export const pipelinesTabInputsBunch = getPersistableMapInjectableBunch<TabId, PipelinesTabInput>()({
  id: "pipelines-tab-inputs",
});

export const pipelinesTabInputInjectable = getInjectable2({
  id: "lens-gitlab-pipelines-tab-input",

  instantiate: (di) => {
    const getInputs = di.inject(pipelinesTabInputsBunch.persistable);
    // Undefined until what was persisted has loaded.
    const inputs = observable.box<ObservableMap<TabId, PipelinesTabInput> | undefined>(undefined, { deep: false });

    void getInputs().then((loaded) => runInAction(() => inputs.set(loaded)));

    return (tabId: TabId) => computed(() => inputs.get()?.get(tabId));
  },
});

const tabIdOf = ({ clusterId, watchKey, versionId }: PipelinesTabInput) =>
  JSON.stringify([clusterId, watchKey, versionId]);

export const openPipelinesTabInjectable = getInjectable2({
  id: "lens-gitlab-open-pipelines-tab",
  consumptions: [openTabInjectionToken, focusTabInjectionToken, tabIsOpenInjectionToken],

  instantiate: (di) => {
    const openTab = di.inject(openTabInjectionToken.for(mainViewTabHostKind).for(pipelinesTabKind).for(di.scopeIds))();
    const focusTab = di.inject(
      focusTabInjectionToken.for(mainViewTabHostKind).for(pipelinesTabKind).for(di.scopeIds),
    )();
    const isOpen = di.inject(tabIsOpenInjectionToken.for(mainViewTabHostKind).for(pipelinesTabKind).for(di.scopeIds))();

    return () => async (input: PipelinesTabInput) => {
      const tabId = tabIdOf(input);

      await ((await isOpen({ tabId })) ? focusTab({ tabId }) : openTab({ tabId, input }));
    };
  },
});

const PipelinesTitle = observer(({ tabId }: TabProps<typeof mainViewTabHostKind>) => {
  const input = useSyncInject(pipelinesTabInputInjectable, tabId).get();

  return <Div>Pipelines{input ? ` · ${input.label}` : ""}</Div>;
});

const PipelinesOfVersion = observer(({ input }: { input: PipelinesTabInput }) => {
  const watchState = useInject(watchOnClusterInjectable)(input.clusterId, input.watchKey);
  const row = watchState.rows.find((each) => each.version.id === input.versionId);
  const watch = watchOfKey(input.watchKey);
  const { repository } = watch;

  // The tab keeps the watch read while it is open, so a run in progress goes on updating.
  useEffect(() => watchState.watch(), [watchState]);

  return (
    <Div $flex={{ direction: "vertical", gap: "l" }} $padding="xxl" $height="full" $overflow={{ y: "auto" }}>
      <Span $font={{ size: "xl" }}>
        {repository} · {row ? pipelinesTitleOf(row) : input.label}
      </Span>
      {row ? (
        <PipelineCards
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

const Pipelines = observer(({ tabId }: TabProps<typeof mainViewTabHostKind>) => {
  const input = useSyncInject(pipelinesTabInputInjectable, tabId).get();

  return input ? <PipelinesOfVersion input={input} /> : null;
});

export const pipelinesTabBunch = getTabKindInjectableBunch({
  tabHostKind: mainViewTabHostKind,
  kind: pipelinesTabKind,
  Component: Pipelines,
  Title: PipelinesTitle,

  onTabCreate: {
    instantiate: (di) => {
      const getInputs = di.inject(pipelinesTabInputsBunch.persistable);

      return () =>
        async ({ tabId, input }) => {
          (await getInputs()).set(tabId, input);
        };
    },
  },
});
