import { describe, expect, it } from "vitest";
import { failedLogLinesOf } from "../src/workflow-runs/failed-log";
import { failedLogInjectable } from "../src/workflow-runs/failed-log.injectable";

// Shaped like a GitLab job trace: a timestamp and stream marker, colours, and section markers.
const output = [
  "2026-10-01T08:00:00.000000Z 00O section_start:1720000000:step_script\r\u001b[0KRunning with gitlab-runner",
  "2026-10-01T08:00:00.100000Z 00O+\u001b[0K$ npm test",
  "2026-10-01T08:00:05.000000Z 00O \u001b[31m✗ adds numbers\u001b[0m",
  "2026-10-01T08:00:05.100000Z 00O WARNING: Node.js 16 is deprecated.",
  "2026-10-01T08:00:05.200000Z 00O section_end:1720000005:step_script\r\u001b[0K",
  "2026-10-01T08:00:05.300000Z 00O ERROR: Job failed: exit code 1.",
  "",
].join("\n");

describe("failedLogLinesOf", () => {
  it("keeps what the trace says, without its timestamps, colours and sections", () => {
    expect(failedLogLinesOf(output)).toEqual([
      { text: "$ npm test", kind: "plain" },
      { text: "✗ adds numbers", kind: "plain" },
      { text: "WARNING: Node.js 16 is deprecated.", kind: "warning" },
      { text: "ERROR: Job failed: exit code 1.", kind: "error" },
    ]);
  });

  it("marks the errors and warnings of Kubernetes' tools, which log in klog's format", () => {
    const klog = [
      '2026-10-01T08:00:00.000000Z 00O E1002 14:09:14.046485   12195 memcache.go:381] "Couldn\'t get current server API group list"',
      "2026-10-01T08:00:00.100000Z 00O W1002 14:09:15.000001   12195 loader.go:222] Config not found",
      "2026-10-01T08:00:00.200000Z 00O E2E tests failed",
    ].join("\n");

    expect(failedLogLinesOf(klog).map((line) => line.kind)).toEqual(["error", "warning", "plain"]);
  });

  it("keeps the last lines only", () => {
    expect(failedLogLinesOf(output, 2).map((line) => line.kind)).toEqual(["warning", "error"]);
  });
});

describe("failedLogInjectable", () => {
  it("asks once, and again after it could not", async () => {
    let calls = 0;
    let fail = true;
    const glab = async (_host: string, path: string) => {
      calls++;
      if (fail) throw new Error("glab: trace not found");
      expect(path).toBe("projects/o%2Fapp/jobs/2/trace");

      return output;
    };
    const log = (failedLogInjectable as any).instantiate({ inject: () => () => glab })("gitlab.com", "o/app", 2);

    await log.load();
    expect(log.state.status).toBe("failed");

    fail = false;
    await log.load();
    await log.load();

    expect(log.state.status).toBe("loaded");
    expect(calls).toBe(2);
  });
});
