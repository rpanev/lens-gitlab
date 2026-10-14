import { describe, expect, it } from "vitest";
import { fluxOwnerOf, fluxStateOf, withFailingDependencies } from "../src/deployments/cluster-images";
import { commitOfRevision, selectedImageOf } from "../src/deployments/flux-kinds";
import { gitProjectOfUrl } from "../src/deployments/git-url";
import { kustomization, sha } from "./fixtures";

describe("fluxStateOf", () => {
  it.each([
    ["ready", [{ type: "Ready", status: "True" }], "ready"],
    ["failed", [{ type: "Ready", status: "False", message: "boom" }], "failed"],
    ["unknown readiness", [{ type: "Ready", status: "Unknown" }], "reconciling"],
    ["no conditions yet", [], "reconciling"],
    [
      "reconciling",
      [
        { type: "Ready", status: "True" },
        { type: "Reconciling", status: "True", reason: "Progressing" },
      ],
      "reconciling",
    ],
    [
      "failing and retried",
      [
        { type: "Ready", status: "False", message: "health check failed" },
        { type: "Reconciling", status: "True", reason: "ProgressingWithRetry" },
      ],
      "failed",
    ],
  ] as const)("%s → %s", (_, conditions, expected) => {
    expect(fluxStateOf(conditions as never).state).toBe(expected);
  });

  it("carries Ready's message", () => {
    expect(fluxStateOf([{ type: "Ready", status: "False", message: "boom" }]).message).toBe("boom");
  });
});

describe("fluxOwnerOf", () => {
  it("prefers the HelmRelease, the nearer owner", () => {
    expect(
      fluxOwnerOf({
        "helm.toolkit.fluxcd.io/name": "backend",
        "helm.toolkit.fluxcd.io/namespace": "apps",
        "kustomize.toolkit.fluxcd.io/name": "apps",
        "kustomize.toolkit.fluxcd.io/namespace": "flux-system",
      }),
    ).toEqual({ kind: "HelmRelease", name: "backend", namespace: "apps" });
  });

  it("falls back to the Kustomization", () => {
    expect(
      fluxOwnerOf({
        "kustomize.toolkit.fluxcd.io/name": "apps",
        "kustomize.toolkit.fluxcd.io/namespace": "flux-system",
      }),
    ).toEqual({ kind: "Kustomization", name: "apps", namespace: "flux-system" });
  });

  it("is nothing for what Flux did not apply", () => {
    expect(fluxOwnerOf({ app: "x" })).toBeUndefined();
    expect(fluxOwnerOf()).toBeUndefined();
  });
});

describe("commitOfRevision", () => {
  it.each([
    [`main@sha1:${sha("dbfd2c5")}`, sha("dbfd2c5")],
    [`v1.2.3@sha1:${sha("abc")}`, sha("abc")],
    ["v1.2.3@sha256:deadbeef", undefined],
    ["0.1.161", undefined],
    [undefined, undefined],
  ])("%s → %s", (revision, expected) => {
    expect(commitOfRevision(revision)).toBe(expected);
  });
});

describe("gitProjectOfUrl", () => {
  it.each([
    ["https://gitlab.com/group/app", { host: "gitlab.com", project: "group/app" }],
    ["https://gitlab.com/Group/Sub/App/", { host: "gitlab.com", project: "group/sub/app" }],
    ["ssh://git@gitlab.example.com/group/app.git", { host: "gitlab.example.com", project: "group/app" }],
    ["git@gitlab.com:group/sub/app.git", { host: "gitlab.com", project: "group/sub/app" }],
    ["https://gitlab.example.com:8443/group/app.git", { host: "gitlab.example.com:8443", project: "group/app" }],
    ["https://github.com/lensapp/lenscloud.git", { host: "github.com", project: "lensapp/lenscloud" }],
    ["https://charts.example.com", undefined],
  ])("%s → %s", (url, expected) => {
    expect(gitProjectOfUrl(url)).toEqual(expected);
  });
});

describe("selectedImageOf", () => {
  it("reads Flux 2.6's latestRef", () => {
    expect(selectedImageOf({ latestRef: { name: "registry/app", tag: "main-76cd335" } })).toBe(
      "registry/app:main-76cd335",
    );
  });

  it("reads latestImage before Flux 2.6", () => {
    expect(selectedImageOf({ latestImage: "registry/app:main-76cd335" })).toBe("registry/app:main-76cd335");
  });

  it("is nothing before anything was selected", () => {
    expect(selectedImageOf()).toBeUndefined();
  });
});

describe("waiting for what a Flux resource depends on", () => {
  const waiting = (name: string, dependsOn: string[]) =>
    kustomization(name, {
      ...fluxStateOf([
        {
          type: "Ready",
          status: "False",
          reason: "DependencyNotReady",
          message: "dependency 'flux-system/system' is not ready",
        },
      ]),
      dependsOn: dependsOn.map((each) => ({ kind: "Kustomization", namespace: "flux-system", name: each })),
    });

  it("is applying, not failing, while what it waits for is only being applied", () => {
    const system = kustomization("system", { state: "reconciling" });
    const [, gateway] = withFailingDependencies([system, waiting("gateway", ["system"])]);

    expect(gateway.state).toBe("reconciling");
    expect(gateway.message).toBe("dependency 'flux-system/system' is not ready");
  });

  it("fails with what it waits for, named along the chain", () => {
    const system = kustomization("system", { state: "failed", message: "kustomize build failed" });
    const resources = withFailingDependencies([
      system,
      waiting("infra", ["system"]),
      { ...waiting("gateway", ["infra"]), attemptedCommit: sha("old") },
    ]);

    expect(resources[2]).toMatchObject({
      state: "failed",
      message: "Waiting for flux-system/system, which fails to apply: kustomize build failed",
    });
    // What it tried last is what it had applied: failing now is of the commit its source has.
    expect(resources[2].attemptedCommit).toBeUndefined();
  });

  it("fails when what it waits for is not found, and stops at a loop", () => {
    expect(withFailingDependencies([waiting("gateway", ["gone"])])[0].message).toBe(
      "Waiting for flux-system/gone, which is not found",
    );
    expect(withFailingDependencies([waiting("a", ["b"]), waiting("b", ["a"])]).map((each) => each.state)).toEqual([
      "reconciling",
      "reconciling",
    ]);
  });
});
