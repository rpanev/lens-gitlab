import { runCliCommandInjectionToken } from "@k8slens/cli-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import { shellQuote } from "./shell-quote";

// A notice on standard error fails the command, the way Lens runs it, so keep glab quiet.
const glabEnv = { NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" };

/**
 * Runs the GitLab CLI against one host. `path` is the API path, already encoded, such as
 * `projects/group%2Fapp/pipelines`. A method of POST sends a write.
 */
export const glabInjectable = getInjectable2({
  id: "lens-gitlab-glab",
  consumptions: [runCliCommandInjectionToken],

  instantiate: (di) => {
    const runCliCommand = di.inject(runCliCommandInjectionToken)();

    return () => (host: string, path: string, method?: "POST") =>
      runCliCommand(
        `glab api${method ? ` --method ${method}` : ""} --hostname ${shellQuote(host)} ${shellQuote(path)}`,
        { env: glabEnv },
      );
  },
});
