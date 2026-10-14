import { getInjectable2 } from "@k8slens/injectable";
import { action, observable } from "mobx";

/**
 * What the user opened or closed in one place, such as one workflows tab, by id; what they did not touch
 * opens as it would by default, which can change, as a workflow that fails opens.
 */
export const expandedInjectable = getInjectable2({
  id: "lens-gitlab-expanded",

  instantiate: () => (_place: string) => {
    const chosen = observable.map<string, boolean>();

    return {
      isOpen: (id: string, byDefault: boolean) => chosen.get(id) ?? byDefault,
      toggle: action((id: string, byDefault: boolean) => chosen.set(id, !(chosen.get(id) ?? byDefault))),
    };
  },
});
