import { shellQuote } from "./shell-quote";

/** What `glab api -i` prints: a status line, headers, a blank line, then the body. */
export interface GlabHttp {
  readonly status: number;
  readonly etag?: string;
  readonly body: string;
}

const statusLine = /^HTTP\/\d+(?:\.\d+)? (\d{3})\b/;

/**
 * Splits a `glab api -i` response into its status, ETag and body. Output that is not an HTTP
 * response, as a GitLab error printed without headers, is the body of a 200.
 */
export const parseGlabHttp = (output: string): GlabHttp => {
  if (!output.startsWith("HTTP/")) return { status: 200, body: output };

  const splitAt = output.search(/\r?\n\r?\n/);
  const head = splitAt === -1 ? output : output.slice(0, splitAt);
  const body = splitAt === -1 ? "" : output.slice(splitAt).replace(/^\r?\n\r?\n/, "");
  const status = Number(statusLine.exec(head)?.[1] ?? 200);
  const etag = /^etag:\s*(.+?)\s*$/im.exec(head)?.[1];

  return { status, etag, body };
};

/** A GitLab error status that `glab api -i` printed and still exited 0. 304 is not an error. */
export const httpErrorOf = (http: GlabHttp) =>
  http.status >= 400 ? `HTTP ${http.status} ${http.body.slice(0, 500)}` : undefined;

/**
 * glab exits with an error on 304, and Lens then reports the command as failed. The body has not
 * changed, so a cached answer is the successful result.
 */
export const isNotModifiedFailure = (error: unknown) =>
  /HTTP(?:\/\d+(?:\.\d+)?)? 304\b/.test(error instanceof Error ? error.message : String(error));

/**
 * The `glab` command for one request. A GET includes response headers, and sends the cached ETag
 * when there is one. GraphQL is one query for a project's latest pipelines, not a REST path.
 */
export const glabCommand = (host: string, path: string, method?: "POST", etag?: string) => {
  if (path.startsWith("graphql?")) {
    const params = new URLSearchParams(path.slice("graphql?".length));
    const fullPath = params.get("fullPath") ?? "";
    const asked = Number(params.get("pipelines"));
    const first = Number.isInteger(asked) && asked > 0 && asked <= 100 ? asked : 100;
    const query = `query ($fullPath: ID!) { project(fullPath: $fullPath) { pipelines(first: ${first}) { nodes { id sha ref status source name finishedAt } } } }`;

    return `glab api graphql --hostname ${shellQuote(host)} -f query=${shellQuote(query)} -f fullPath=${shellQuote(fullPath)}`;
  }

  const header = !method && etag ? `-H ${shellQuote(`If-None-Match: ${etag}`)}` : "";
  const include = method ? "" : "-i";
  const verb = method ? `--method ${method}` : "";

  return ["glab api", include, header, verb, `--hostname ${shellQuote(host)}`, shellQuote(path)].filter(Boolean).join(" ");
};
