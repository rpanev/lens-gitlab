/** Why a call of the GitLab CLI failed, as far as its output tells. */
export type GlabCause =
  | "not-installed"
  | "expired-sign-in"
  | "not-signed-in"
  | "sso"
  | "rate-limit"
  | "no-access"
  | "no-ref"
  | "offline"
  | "unknown";

export interface GlabProblem {
  readonly cause: GlabCause;
  /** What is wrong, in a line. */
  readonly title: string;
  /** What to do about it. */
  readonly fix: string;
  readonly link?: string;
  /**
   * Whether it waits for the user rather than passing by itself: checking again would only fail again,
   * so checks stop until the user checks again themselves.
   */
  readonly waitsForUser: boolean;
  /** What the CLI said. */
  readonly detail: string;
}

// Most specific first: an expired token's output also suggests signing in. A shell's "glab: not found" ends
// its line, where GitLab's "404 Not Found" goes on. A missing commit or branch is a 404 too, named apart
// from a missing project.
const causes: readonly { cause: GlabCause; pattern: RegExp }[] = [
  {
    cause: "not-installed",
    pattern:
      /command not found|glab: not found\s*$|not found: glab|spawn glab ENOENT|is not recognized as an internal or external command/im,
  },
  { cause: "rate-limit", pattern: /rate limit|429/i },
  { cause: "sso", pattern: /SAML|pending approval|single sign-on/i },
  { cause: "no-ref", pattern: /404 (?:Commit|Branch|Tag|Ref) Not Found/i },
  { cause: "expired-sign-in", pattern: /invalid_token|token is expired|bad credentials|HTTP 401|\b401\b/i },
  { cause: "not-signed-in", pattern: /glab auth login|not authenticated|no token/i },
  { cause: "no-access", pattern: /404 Project Not Found|HTTP 404|\b404\b/i },
  {
    cause: "offline",
    pattern:
      /error connecting to|could not resolve host|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network is unreachable|i\/o timeout|TLS handshake timeout|no such host/i,
  },
];

/** A CLI error with any sign-in token taken out, so a tooltip cannot show one. */
export const redactSecrets = (text: string) =>
  text
    .replace(
      /\b(?:glpat|glptt|gldt|glrt|glsoat|gloas|glft|glcbt)-[A-Za-z0-9_-]{8,}\b|PRIVATE-TOKEN:\s*\S+|Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
      "[redacted]",
    )
    .slice(0, 2000);

/** Recognises why a call of the GitLab CLI failed, and says what to do, for the project it was about. */
export const glabProblemOf = (raw: string, project: string): GlabProblem => {
  const cause = causes.find(({ pattern }) => pattern.test(raw))?.cause ?? "unknown";
  const detail = redactSecrets(raw);
  const problem = (title: string, fix: string, waitsForUser: boolean, link?: string): GlabProblem => ({
    cause,
    title,
    fix,
    link,
    waitsForUser,
    detail,
  });

  switch (cause) {
    case "not-installed":
      return problem(
        "Lens cannot find the GitLab CLI (glab).",
        "Install it, or if it is installed, restart Lens so it picks up your shell's PATH.",
        true,
        "https://gitlab.com/gitlab-org/cli",
      );
    case "expired-sign-in":
      return problem("The GitLab CLI's sign-in has expired.", 'Sign in again with "glab auth login".', true);
    case "not-signed-in":
      return problem(
        "The GitLab CLI is not signed in.",
        'Sign in with "glab auth login". For a GitLab you host yourself, add --hostname and that host.',
        true,
      );
    case "sso":
      return problem(
        `${project} needs single sign-on for the GitLab CLI's sign-in.`,
        "Authorize the account for the group, then sign in again with glab.",
        true,
      );
    case "rate-limit":
      return problem("GitLab's rate limit is reached.", "Checking waits for the check interval.", false);
    case "no-access":
      return problem(
        `${project} was not found, or the signed-in account cannot see it.`,
        "Check the project and host in the GitLabOps settings, and the account glab is signed in with.",
        true,
      );
    case "no-ref":
      return problem(
        `The branch or tag watched does not exist in ${project}.`,
        "Check the watch in the GitLabOps settings.",
        true,
      );
    case "offline":
      return problem("GitLab cannot be reached.", "Checking goes on, and picks up once GitLab can be reached.", false);
    case "unknown":
      return problem("The GitLab CLI failed.", "Checking goes on. What glab said:", false);
  }
};
