import { describe, expect, it } from "vitest";
import { aheadOf, comparePathOf, compareUrlOf, rangeBehindOf } from "../src/pipelines/compare";
import { playJobPathOf } from "../src/pipelines/play-job.injectable";

const sha = (prefix: string) => prefix.padEnd(40, "a");

describe("aheadOf", () => {
  it("keeps the commits between the two versions and the merge requests that landed in them", () => {
    const landed = sha("aaa");
    const other = sha("bbb");
    const ahead = aheadOf(
      "gitlab.com",
      "group/app",
      {
        commits: [
          { id: landed, short_id: "aaaaaaa", title: "Add checkout", web_url: "https://gitlab.com/group/app/-/commit/" + landed },
          { id: other, short_id: "bbbbbbb", title: "Fix tax" },
        ],
      },
      [
        { iid: 12, title: "Checkout", merge_commit_sha: landed },
        { iid: 9, title: "Old work", merge_commit_sha: sha("ccc"), sha: sha("ddd") },
        { iid: 8, title: "Squashed", squash_commit_sha: other },
      ],
    );

    expect(ahead.commits.map((commit) => commit.label)).toEqual(["aaaaaaa", "bbbbbbb"]);
    expect(ahead.mergeRequests.map((request) => request.iid)).toEqual([12, 8]);
    expect(ahead.commits[0]?.url).toBe(`https://gitlab.com/group/app/-/commit/${landed}`);
  });
});

describe("rangeBehindOf", () => {
  it("starts at the oldest version still running and ends at the latest", () => {
    expect(
      rangeBehindOf(
        [
          { id: "new", label: "new", behind: 0 },
          { id: "old", label: "old", behind: 3 },
          { id: "mid", label: "mid", behind: 1 },
        ],
        { id: "new", label: "new" },
      ),
    ).toEqual({ from: "old", to: "new", fromLabel: "old", toLabel: "new" });
  });

  it("has nothing to bring in when everything runs the latest", () => {
    expect(rangeBehindOf([{ id: "new", label: "new", behind: 0 }], { id: "new", label: "new" })).toBeUndefined();
  });
});

describe("compare paths", () => {
  it("asks GitLab for the compare and builds the page the user opens", () => {
    expect(comparePathOf("group/app", "abc", "def")).toBe(
      "projects/group%2Fapp/repository/compare?from=abc&to=def",
    );
    expect(compareUrlOf("gitlab.com", "group/app", "abc", "def")).toBe(
      "https://gitlab.com/group/app/-/compare/abc...def",
    );
    expect(playJobPathOf("group/app", 42)).toBe("projects/group%2Fapp/jobs/42/play");
  });
});
