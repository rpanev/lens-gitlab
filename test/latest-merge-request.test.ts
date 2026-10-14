import { describe, expect, it } from "vitest";
import { latestMergeRequestOf, mergeStandingOf } from "../src/workflow-runs/latest-merge-request";
import { run, sha } from "./fixtures";

const request = (state: string, status?: string, extra: Record<string, string> = {}) => ({
  iid: 12,
  title: "Ship the demo",
  state,
  target_branch: "demo",
  head_pipeline: status ? { status } : null,
  ...extra,
});

describe("the latest merge request into a branch", () => {
  it("takes the newest merged one, ahead of an open one updated later and a closed one", () => {
    const latest = latestMergeRequestOf("lab.example.com", "group/app", [
      { ...request("opened"), iid: 20, title: "Still open" },
      { ...request("closed", "failed"), iid: 13 },
      request("merged", "success"),
    ]);

    expect(latest).toMatchObject({ iid: 12, state: "merged", projectUrl: "https://lab.example.com/group/app" });
  });

  it("reads the merge commit's pipelines when GitLab left the merge request without one", () => {
    const merge = sha("aaa3554");
    const standing = mergeStandingOf(
      latestMergeRequestOf("gitlab.com", "group/app", [
        request("merged", undefined, { merge_commit_sha: merge, title: "Dev -> Demo" }),
      ]),
      [
        { id: merge, title: "Merge branch 'dev' into 'demo'", runs: [run("pipeline")] },
        { id: sha("bbb"), title: "Merge branch 'old' into 'demo'", runs: [run("pipeline", "completed", "failure", 2)] },
      ],
    );

    expect(standing.text).toBe("Passed");
    expect(standing.detail).toBe("!12 · Dev -> Demo");
    expect(standing.failed).toBe(false);
  });

  it("uses the newest merge commit when the open request is not that merge", () => {
    const standing = mergeStandingOf(latestMergeRequestOf("gitlab.com", "group/app", [request("opened")]), [
      { id: sha("aaa"), title: "Merge branch 'dev' into 'demo'", runs: [run("pipeline", "completed", "failure")] },
    ]);

    expect(standing.text).toBe("Failed");
    expect(standing.detail).toBe("Merge branch 'dev' into 'demo'");
    expect(standing.failed).toBe(true);
    expect(standing.projectUrl).toBe("https://gitlab.com/group/app");
  });
});
