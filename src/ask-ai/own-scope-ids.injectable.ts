import { getInjectable2 } from "@k8slens/injectable";

/** The scopes of this extension, so a component can hand them to its own Ask AI terminal. */
export const ownScopeIdsInjectable = getInjectable2({
  id: "lens-gitlab-own-scope-ids",

  instantiate: (di) => () => di.scopeIds,
});
