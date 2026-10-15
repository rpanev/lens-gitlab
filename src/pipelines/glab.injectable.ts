import { runCliCommandInjectionToken } from "@k8slens/cli-contracts";
import { getInjectable2 } from "@k8slens/injectable";
import { glabCommand, httpErrorOf, isNotModifiedFailure, parseGlabHttp } from "./glab-http";

// A notice on standard error fails the command, the way Lens runs it, so keep glab quiet.
const glabEnv = { NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" };

/**
 * Runs the GitLab CLI against one host. `path` is the API path, already encoded, such as
 * `projects/group%2Fapp/pipelines`, or `graphql?…` for one GraphQL query. A method of POST sends a write.
 * `json` reads a GET and, when GitLab answers 304, returns the previous value without parsing it again.
 */
export type Glab = ((host: string, path: string, method?: "POST") => Promise<string>) & {
  json?: (host: string, path: string) => Promise<unknown>;
};

/** A GET's JSON, or the value already parsed when GitLab answered 304. */
export const readGlabJson = (glab: Glab, host: string, path: string): Promise<unknown> =>
  glab.json ? glab.json(host, path) : glab(host, path).then((body) => JSON.parse(body) as unknown);

interface Cached {
  etag?: string;
  body: string;
  parsed?: unknown;
  notModified: boolean;
}

export const glabInjectable = getInjectable2({
  id: "lens-gitlab-glab",
  consumptions: [runCliCommandInjectionToken],

  instantiate: (di) => {
    const runCliCommand = di.inject(runCliCommandInjectionToken)();

    return (): Glab => {
      const cache = new Map<string, Cached>();

      const call = async (host: string, path: string, method?: "POST") => {
        const key = `${method ?? "GET"}\n${host}\n${path}`;
        const cached = method ? undefined : cache.get(key);
        // glab exits on 304, so Lens reports a failed command. The cached body is still the answer.
        let reused = false;
        const output = await runCliCommand(glabCommand(host, path, method, cached?.etag), { env: glabEnv }).catch(
          (error: unknown) => {
            if (!cached || !isNotModifiedFailure(error)) throw error;

            cached.notModified = true;
            reused = true;

            return cached.body;
          },
        );

        if (reused) return output;

        if (method === "POST" || path.startsWith("graphql?")) return output;

        const http = parseGlabHttp(output);

        if (http.status === 304) {
          if (!cached) throw new Error("GitLab returned 304 for a request that was not cached.");

          cached.notModified = true;

          return cached.body;
        }

        const failed = httpErrorOf(http);

        if (failed) throw new Error(failed);

        cache.set(key, { etag: http.etag, body: http.body, notModified: false });

        return http.body;
      };

      const json = async (host: string, path: string) => {
        const key = `GET\n${host}\n${path}`;
        const before = cache.get(key);
        const body = await call(host, path);
        const after = cache.get(key);

        if (after?.notModified && before?.parsed !== undefined) return before.parsed;

        const parsed: unknown = JSON.parse(body);

        if (after) after.parsed = parsed;

        return parsed;
      };

      return Object.assign(call, { json });
    };
  },
});
