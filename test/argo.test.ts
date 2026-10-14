import { describe, expect, it } from "vitest";
import { applicationResourceOf, argoCommitsOf, argoOwnerOf, argoStateOf } from "../src/deployments/argo-kinds";
import { isSameOwner } from "../src/deployments/cluster-images";
import { gitOpsSyncsOf } from "../src/deployments/gitops-syncs";
import { syncStatusOf } from "../src/dashboard/flux-stage";
import { cluster, commit, sha } from "./fixtures";

describe("argoStateOf", () => {
  it.each([
    ["synced and healthy", { sync: { status: "Synced" }, health: { status: "Healthy" } }, "ready"],
    ["a sync running", { operationState: { phase: "Running" }, health: { status: "Healthy" } }, "reconciling"],
    [
      "progressing after a sync",
      { operationState: { phase: "Succeeded" }, health: { status: "Progressing" } },
      "reconciling",
    ],
    ["missing resources, never synced", { health: { status: "Missing" } }, "ready"],
    [
      "a failed sync",
      { operationState: { phase: "Failed", message: "one or more objects failed to apply" } },
      "failed",
    ],
    ["a sync error", { operationState: { phase: "Error", message: "boom" } }, "failed"],
    [
      "degraded",
      { operationState: { phase: "Succeeded" }, health: { status: "Degraded", message: "crash loop" } },
      "failed",
    ],
    ["a comparison error", { conditions: [{ type: "ComparisonError", message: "repository not found" }] }, "failed"],
    ["a warning only", { conditions: [{ type: "OrphanedResourceWarning" }], health: { status: "Healthy" } }, "ready"],
  ])("%s → %s", (_, status, state) => {
    expect(argoStateOf(status).state).toBe(state);
  });

  it("says why it fails", () => {
    expect(argoStateOf({ health: { status: "Degraded", message: "crash loop" } }).message).toBe("crash loop");
    expect(argoStateOf({ health: { status: "Degraded", message: "" } }).message).toBe("Degraded");
  });
});

describe("argoCommitsOf", () => {
  it("takes the last successful sync as applied and the compared revision as the target", () => {
    expect(
      argoCommitsOf({
        sync: { status: "OutOfSync", revision: sha("bbbbbbb") },
        operationState: { phase: "Succeeded", syncResult: { revision: sha("aaaaaaa") } },
      }),
    ).toEqual({ applied: sha("aaaaaaa"), attempted: sha("aaaaaaa"), target: sha("bbbbbbb") });
  });

  it("falls back to the history when the last sync did not succeed", () => {
    expect(
      argoCommitsOf({
        operationState: { phase: "Failed", syncResult: { revision: sha("bbbbbbb") } },
        history: [{ revision: sha("ccccccc") }, { revision: sha("aaaaaaa") }],
      }),
    ).toMatchObject({ applied: sha("aaaaaaa"), attempted: sha("bbbbbbb") });
  });

  it("reads the first source of a multi-source Application", () => {
    expect(argoCommitsOf({ sync: { revisions: [sha("aaaaaaa"), "1.2.3"] } }).target).toBe(sha("aaaaaaa"));
  });
});

describe("argoOwnerOf", () => {
  it.each([
    [
      {},
      { "argocd.argoproj.io/tracking-id": "guestbook:apps/Deployment:guestbook/guestbook-ui" },
      { namespace: "", name: "guestbook" },
    ],
    [
      {},
      { "argocd.argoproj.io/tracking-id": "team-a_api:apps/Deployment:apps/api" },
      { namespace: "team-a", name: "api" },
    ],
    [{ "app.kubernetes.io/instance": "guestbook" }, {}, { namespace: "", name: "guestbook" }],
  ])("%#", (labels, annotations, expected) => {
    expect(argoOwnerOf(labels, annotations)).toEqual({ kind: "Application", ...expected });
  });

  it("is nothing for what Argo CD does not track", () => {
    expect(argoOwnerOf({ app: "x" }, {})).toBeUndefined();
  });

  it("finds an Application by name when the tracking does not say its namespace", () => {
    expect(
      isSameOwner(
        { kind: "Application", namespace: "", name: "guestbook" },
        { kind: "Application", namespace: "argocd", name: "guestbook" },
      ),
    ).toBe(true);
    expect(
      isSameOwner(
        { kind: "Application", namespace: "team-a", name: "api" },
        { kind: "Application", namespace: "argocd", name: "api" },
      ),
    ).toBe(false);
  });
});

const application = (
  status: object,
  source: object = { repoURL: "https://gitlab.com/o/gitops.git", targetRevision: "main", path: "apps" },
) =>
  applicationResourceOf({
    metadata: { namespace: "argocd", name: "apps" },
    spec: { source: source as never },
    status: status as never,
  });

describe("applicationResourceOf", () => {
  it("names its Git source", () => {
    const resource = application({
      sync: { status: "Synced", revision: sha("aaaaaaa") },
      operationState: { phase: "Succeeded", syncResult: { revision: sha("aaaaaaa") } },
    });

    expect(resource.inlineSource).toMatchObject({
      repository: "o/gitops",
      host: "gitlab.com",
      branch: "main",
      commit: sha("aaaaaaa"),
    });
    expect(resource.appliedCommit).toBe(sha("aaaaaaa"));
  });

  it("follows a chart from a chart repository by its version, not a commit", () => {
    const resource = application(
      { sync: { revision: "1.4.1" }, operationState: { phase: "Succeeded", syncResult: { revision: "1.4.0" } } },
      { repoURL: "https://charts.example.com", chart: "api", targetRevision: "1.4.x" },
    );

    expect(resource.inlineSource).toBeUndefined();
    expect(resource.appliedCommit).toBeUndefined();
    expect(resource.chart).toEqual({ applied: "1.4.0", attempted: "1.4.1" });
  });
});

describe("gitOpsSyncsOf with Applications", () => {
  const commits = [commit("aaaaaaa"), commit("bbbbbbb")];
  const syncsOf = (resource: ReturnType<typeof application>) =>
    gitOpsSyncsOf("o/gitops", "main", commits, cluster({ deployResources: [resource] }));

  it.each([
    [
      "synced to the latest",
      {
        sync: { status: "Synced", revision: sha("aaaaaaa") },
        operationState: { phase: "Succeeded", syncResult: { revision: sha("aaaaaaa") } },
      },
      "Latest",
    ],
    [
      "out of sync with a newer commit",
      {
        sync: { status: "OutOfSync", revision: sha("aaaaaaa") },
        operationState: { phase: "Succeeded", syncResult: { revision: sha("bbbbbbb") } },
      },
      "aaaaaaa fetched, not applied yet",
    ],
    [
      "syncing it",
      {
        sync: { status: "OutOfSync", revision: sha("aaaaaaa") },
        operationState: { phase: "Running", syncResult: { revision: sha("bbbbbbb") } },
        history: [{ revision: sha("bbbbbbb") }],
      },
      "Applying aaaaaaa",
    ],
    [
      "failing to sync it",
      {
        sync: { status: "OutOfSync", revision: sha("aaaaaaa") },
        operationState: { phase: "Failed", syncResult: { revision: sha("aaaaaaa") } },
        history: [{ revision: sha("bbbbbbb") }],
      },
      "Failed to apply aaaaaaa",
    ],
  ])("%s", (_, status, expected) => {
    const [sync] = syncsOf(application(status));

    expect(syncStatusOf(sync)).toBe(expected);
  });

  it("leaves out Applications of other repositories or branches", () => {
    const status = { sync: { revision: sha("aaaaaaa") } };

    expect(syncsOf(application(status, { repoURL: "https://gitlab.com/o/other", targetRevision: "main" }))).toEqual([]);
    expect(syncsOf(application(status, { repoURL: "https://gitlab.com/o/gitops", targetRevision: "develop" }))).toEqual(
      [],
    );
  });
});

describe("Applications following HEAD", () => {
  const commits = [commit("aaaaaaa")];
  const synced = {
    sync: { status: "Synced", revision: sha("aaaaaaa") },
    operationState: { phase: "Succeeded", syncResult: { revision: sha("aaaaaaa") } },
  };

  it.each([["HEAD"], [undefined], ["refs/heads/main"]])(
    "targetRevision %s follows the watched branch",
    (targetRevision) => {
      const resource = application(synced, { repoURL: "https://gitlab.com/o/gitops", targetRevision, path: "apps" });

      expect(gitOpsSyncsOf("o/gitops", "main", commits, cluster({ deployResources: [resource] }))).toHaveLength(1);
    },
  );

  it("a tag is not a branch", () => {
    const resource = application(synced, {
      repoURL: "https://gitlab.com/o/gitops",
      targetRevision: "v1.2.3",
      path: "apps",
    });

    expect(gitOpsSyncsOf("o/gitops", "main", commits, cluster({ deployResources: [resource] }))).toEqual([]);
  });
});

describe("argoStateOf for an Application never synced", () => {
  it("is not under way", () => {
    expect(argoStateOf({ sync: { status: "OutOfSync" }, health: { status: "Missing" } }).state).toBe("ready");
  });
});
