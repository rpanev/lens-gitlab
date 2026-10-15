import { describe, expect, it } from "vitest";
import { browserUrlOf, urlOnHost } from "../src/pipelines/browser-url";
import { glabProblemOf } from "../src/pipelines/glab-problems";

describe("urlOnHost", () => {
  it("keeps a page on the watched host", () => {
    expect(urlOnHost("https://gitlab.com/group/app/-/pipelines/1", "gitlab.com")).toBe(
      "https://gitlab.com/group/app/-/pipelines/1",
    );
    expect(urlOnHost("https://GitLab.Example.com:8443/group/app", "gitlab.example.com:8443")).toBe(
      "https://gitlab.example.com:8443/group/app",
    );
  });

  it("drops a page on another host, a credential, or a scheme that is not https", () => {
    expect(urlOnHost("https://evil.example/phish", "gitlab.com")).toBeUndefined();
    expect(urlOnHost("https://user:glpat-abcdefghijklmnopqrst@gitlab.com/group/app", "gitlab.com")).toBeUndefined();
    expect(urlOnHost("javascript:alert(1)", "gitlab.com")).toBeUndefined();
    expect(urlOnHost("file:///etc/passwd", "gitlab.com")).toBeUndefined();
    expect(urlOnHost("http://gitlab.com/group/app", "gitlab.com")).toBeUndefined();
  });

  it("allows http only on this machine", () => {
    expect(browserUrlOf("http://localhost:8080/group/app")).toBe("http://localhost:8080/group/app");
    expect(urlOnHost("http://127.0.0.1:8080/group/app", "127.0.0.1:8080")).toBe("http://127.0.0.1:8080/group/app");
    expect(browserUrlOf("http://gitlab.example.com/group/app")).toBeUndefined();
  });
});

describe("redactSecrets", () => {
  it("takes a GitLab token out of what the CLI said, and still recognises the failure", () => {
    const problem = glabProblemOf(
      "GET /projects: 401 {\"message\":\"401 Unauthorized\"} PRIVATE-TOKEN: glpat-abcdefghijklmnopqrstuvwxyz",
      "group/app",
    );

    expect(problem.cause).toBe("expired-sign-in");
    expect(problem.detail).not.toContain("glpat-");
    expect(problem.detail).toContain("[redacted]");
  });
});
