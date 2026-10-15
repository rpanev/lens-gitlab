import { describe, expect, it } from "vitest";
import { glabCommand, httpErrorOf, isNotModifiedFailure, parseGlabHttp } from "../src/pipelines/glab-http";
import { glabProblemOf } from "../src/pipelines/glab-problems";

describe("parseGlabHttp", () => {
  it("reads the status, the ETag and the body", () => {
    const output = 'HTTP/2.0 200 OK\nContent-Type: application/json\nEtag: W/"abc"\n\n[{"id":1}]';

    expect(parseGlabHttp(output)).toEqual({ status: 200, etag: 'W/"abc"', body: '[{"id":1}]' });
  });

  it("reads a 304 with no body", () => {
    const output = 'HTTP/1.1 304 Not Modified\r\nETag: W/"abc"\r\n\r\n';

    expect(parseGlabHttp(output)).toEqual({ status: 304, etag: 'W/"abc"', body: "" });
  });

  it("keeps output that has no HTTP status as the body", () => {
    expect(parseGlabHttp('[{"id":1}]')).toEqual({ status: 200, body: '[{"id":1}]' });
  });
});

describe("isNotModifiedFailure", () => {
  it("recognises glab failing the command when GitLab answers 304", () => {
    const error = new Error(
      `Command failed: glab api -i -H 'If-None-Match: W/"311a5f9b"' --hostname 'lab.centsight.com' 'projects/centsight%2Ftools-gateway/repository/commits/demo' glab: HTTP 304`,
    );

    expect(isNotModifiedFailure(error)).toBe(true);
    expect(isNotModifiedFailure(new Error("glab: HTTP 404"))).toBe(false);
  });
});

describe("httpErrorOf", () => {
  it("turns a GitLab error status into a failure the reader can recognise", () => {
    const http = parseGlabHttp('HTTP/2.0 401 Unauthorized\n\n{"message":"401 Unauthorized"}');
    const problem = glabProblemOf(httpErrorOf(http) ?? "", "group/app");

    expect(problem.cause).toBe("expired-sign-in");
    expect(httpErrorOf(parseGlabHttp('HTTP/2.0 200 OK\n\n[]'))).toBeUndefined();
  });
});

describe("glabCommand", () => {
  it("sends a conditional GET with response headers", () => {
    const command = glabCommand("gitlab.example.com", "projects/o%2Fapp/pipelines?per_page=100", undefined, 'W/"abc"');

    expect(command).toContain("glab api -i");
    expect(command).toContain(`-H 'If-None-Match: W/"abc"'`);
    expect(command).toContain("--hostname 'gitlab.example.com'");
  });

  it("asks GraphQL for the latest pipelines in one query", () => {
    const command = glabCommand("gitlab.com", "graphql?fullPath=group%2Fapp&pipelines=100");

    expect(command.startsWith("glab api graphql")).toBe(true);
    expect(command).toContain("pipelines(first: 100)");
    expect(command).toContain("-f fullPath='group/app'");
    expect(command).not.toContain(" -i ");
  });

  it("does not send a conditional header for a write", () => {
    const command = glabCommand("gitlab.com", "projects/o%2Fapp/pipelines/1/retry", "POST", 'W/"abc"');

    expect(command).toContain("--method POST");
    expect(command).not.toContain("If-None-Match");
    expect(command).not.toContain(" -i ");
  });
});
