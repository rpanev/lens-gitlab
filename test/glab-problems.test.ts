import { describe, expect, it } from "vitest";
import { glabProblemOf } from "../src/pipelines/glab-problems";

describe("glabProblemOf", () => {
  it.each([
    ["sh: glab: command not found", "not-installed", true],
    ["zsh:1: command not found: glab", "not-installed", true],
    ["/bin/sh: 1: glab: not found", "not-installed", true],
    ["'glab' is not recognized as an internal or external command", "not-installed", true],
    ["fatal: not authenticated. please run `glab auth login`", "not-signed-in", true],
    ['{"message":"401 Unauthorized"}\nglab: invalid_token (HTTP 401)', "expired-sign-in", true],
    ["403 Forbidden: SAML single sign-on is required", "sso", true],
    ['{"message":"404 Project Not Found"}', "no-access", true],
    ['{"message":"404 Commit Not Found"}', "no-ref", true],
    ['{"message":"404 Branch Not Found"}', "no-ref", true],
    ["429 Too Many Requests: Rate limit exceeded", "rate-limit", false],
    ["error connecting to gitlab.com\ncheck your internet connection", "offline", false],
    ["dial tcp: lookup gitlab.com: no such host ... i/o timeout", "offline", false],
    ["something else entirely", "unknown", false],
  ])("%s → %s", (detail, cause, waitsForUser) => {
    const problem = glabProblemOf(detail, "group/app");

    expect(problem.cause).toBe(cause);
    expect(problem.waitsForUser).toBe(waitsForUser);
    expect(problem.detail).toBe(detail);
  });

  it("names the project it was about", () => {
    expect(glabProblemOf('{"message":"404 Project Not Found"}', "group/app").title).toContain("group/app");
  });

  it("links to the GitLab CLI when it is missing", () => {
    expect(glabProblemOf("sh: glab: command not found", "group/app").link).toBe("https://gitlab.com/gitlab-org/cli");
  });
});
