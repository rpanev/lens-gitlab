import { openLinkInBrowserInjectionToken } from "@k8slens/electron-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import { browserUrlOf } from "./browser-url";
import type { Version } from "./version";

export const openVersionInjectable = getInjectable2({
  id: "lens-gitlab-open-version",
  consumptions: [openLinkInBrowserInjectionToken],

  instantiate: (di) => {
    const openLinkInBrowser = di.inject(openLinkInBrowserInjectionToken)();

    // A commit's page lists the checks its runs made; a release's page, what it ships.
    // Lens opens only http and https, and rejects the rest: a page that is neither is not asked for.
    return () => (version: Pick<Version, "url">) => {
      const url = browserUrlOf(version.url);

      return url ? openLinkInBrowser(url) : undefined;
    };
  },
});
