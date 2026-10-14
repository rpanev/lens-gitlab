import { getAskAiFunctionInjectableBunch, getAskAiFunctionKind } from "@k8slens/ask-ai-contracts";
import { openSettingsTabInjectable } from "../settings/settings-tab.injectable";

export const openSettingsFunctionKind = getAskAiFunctionKind<{ clusterId: string }>()("open-settings");

export default getAskAiFunctionInjectableBunch({
  kind: openSettingsFunctionKind,
  offeredIn: "every-conversation",
  description:
    "Opens the GitLabOps settings of a cluster in Lens, where watched projects are listed and edited in a form. Use it when the user asks to open GitLabOps settings. It does not change a project by itself. Watching, changing or stopping a project is save-watched-project, and only inside this extension's own Ask AI terminal on the GitLabOps dashboard.",
  inputDescription: "`clusterId` (string): the Lens cluster id of the cluster the conversation is about.",
  outputDescription: "Nothing. Resolves once the settings tab is open.",
  invoke: {
    instantiate: (di) => {
      const openSettings = di.inject(openSettingsTabInjectable)();

      return () =>
        async ({ clusterId }) => {
          await openSettings(clusterId);
        };
    },
  },
});
