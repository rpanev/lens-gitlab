import { describe, expect, it } from "vitest";
import { syncStatusOf } from "../src/dashboard/flux-stage";
import { gitOpsSyncsOf, syncsOfVersion } from "../src/deployments/gitops-syncs";
import { cluster, commit, gitSource, kustomization, sha } from "./fixtures";

const commits = [commit("aaaaaaa"), commit("bbbbbbb"), commit("ccccccc")];

describe("gitOpsSyncsOf", () => {
  it("finds the Kustomizations applying the watched repository and branch only", () => {
    const syncs = gitOpsSyncsOf(
      "O/GitOps",
      "main",
      commits,
      cluster({
        deployResources: [
          kustomization("apps", { appliedCommit: sha("aaaaaaa") }),
          kustomization("platform", { appliedCommit: sha("aaaaaaa") }),
          kustomization("other-branch", { appliedCommit: sha("aaaaaaa") }),
        ],
        gitSources: [
          gitSource("apps", { commit: sha("aaaaaaa") }),
          gitSource("platform", { repository: "o/platform", commit: sha("aaaaaaa") }),
          gitSource("other-branch", { branch: "develop", commit: sha("aaaaaaa") }),
        ],
      }),
    );

    expect(syncs.map((sync) => sync.resource.name)).toEqual(["apps"]);
  });

  it.each([
    ["applied the latest", { appliedCommit: sha("aaaaaaa") }, sha("aaaaaaa"), "Latest"],
    ["applied the one before", { appliedCommit: sha("bbbbbbb") }, sha("bbbbbbb"), "1 commit behind"],
    ["applied an older one", { appliedCommit: sha("ccccccc") }, sha("ccccccc"), "2 commits behind"],
    ["older than the commits watched", { appliedCommit: sha("fffffff") }, sha("fffffff"), "3+ commits behind"],
    ["fetched a newer one", { appliedCommit: sha("bbbbbbb") }, sha("aaaaaaa"), "aaaaaaa fetched, not applied yet"],
    [
      "applying it",
      { appliedCommit: sha("bbbbbbb"), state: "reconciling" as const },
      sha("aaaaaaa"),
      "Applying aaaaaaa",
    ],
    [
      "failed to apply it",
      { appliedCommit: sha("bbbbbbb"), attemptedCommit: sha("aaaaaaa"), state: "failed" as const },
      sha("aaaaaaa"),
      "Failed to apply aaaaaaa",
    ],
    [
      "failed on the applied commit again",
      { appliedCommit: sha("aaaaaaa"), attemptedCommit: sha("aaaaaaa"), state: "failed" as const },
      sha("aaaaaaa"),
      "Failed to apply aaaaaaa",
    ],
    [
      "reconciling what it applied already",
      { appliedCommit: sha("aaaaaaa"), state: "reconciling" as const },
      sha("aaaaaaa"),
      "Latest",
    ],
    ["never applied", {}, sha("aaaaaaa"), "aaaaaaa fetched, not applied yet"],
    ["never applied, nothing fetched yet", {}, undefined, "Not applied yet"],
  ])("%s", (_, overrides, sourceCommit, status) => {
    const [sync] = gitOpsSyncsOf(
      "o/gitops",
      "main",
      commits,
      cluster({
        deployResources: [kustomization("apps", overrides)],
        gitSources: [gitSource("apps", { commit: sourceCommit })],
      }),
    );

    expect(syncStatusOf(sync)).toBe(status);
  });

  it("links a commit older than those watched to its page", () => {
    const [sync] = gitOpsSyncsOf(
      "o/gitops",
      "main",
      commits,
      cluster({
        deployResources: [kustomization("apps", { appliedCommit: sha("fffffff") })],
        gitSources: [gitSource("apps", { commit: sha("fffffff") })],
      }),
    );

    expect(sync.applied?.url).toBe(`https://gitlab.com/o/gitops/-/commit/${sha("fffffff")}`);
  });

  it("lists what is unsettled first", () => {
    const syncs = gitOpsSyncsOf(
      "o/gitops",
      "main",
      commits,
      cluster({
        deployResources: [
          kustomization("settled", { appliedCommit: sha("aaaaaaa") }),
          kustomization("failing", { appliedCommit: sha("bbbbbbb"), state: "failed", attemptedCommit: sha("aaaaaaa") }),
        ],
        gitSources: [
          gitSource("settled", { commit: sha("aaaaaaa") }),
          gitSource("failing", { commit: sha("aaaaaaa") }),
        ],
      }),
    );

    expect(syncs.map((sync) => sync.resource.name)).toEqual(["failing", "settled"]);
  });
});

describe("syncsOfVersion", () => {
  it("puts each Kustomization under the commit it applied, or the one on its way", () => {
    const syncs = gitOpsSyncsOf(
      "o/gitops",
      "main",
      commits,
      cluster({
        deployResources: [
          kustomization("settled", { appliedCommit: sha("aaaaaaa") }),
          kustomization("behind", { appliedCommit: sha("bbbbbbb") }),
          kustomization("applying", { appliedCommit: sha("ccccccc"), state: "reconciling" }),
        ],
        gitSources: [
          gitSource("settled", { commit: sha("aaaaaaa") }),
          gitSource("behind", { commit: sha("bbbbbbb") }),
          gitSource("applying", { commit: sha("aaaaaaa") }),
        ],
      }),
    );

    const byName = (id: string) => syncsOfVersion(id, syncs).map((each) => [each.name, each.state]);

    expect(byName(sha("aaaaaaa"))).toEqual([
      ["applying", "rolling-out"],
      ["settled", "running"],
    ]);
    expect(byName(sha("bbbbbbb"))).toEqual([["behind", "running"]]);
    // Applying a newer commit, it still has the older one applied, so it is under both.
    expect(byName(sha("ccccccc"))).toEqual([["applying", "running"]]);
  });
});
