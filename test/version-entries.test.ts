import { describe, expect, it } from "vitest";
import type { GitOpsSync } from "../src/deployments/gitops-syncs";
import type { Service } from "../src/deployments/services";
import { entriesOfVersion } from "../src/deployments/version-entries";
import { gitSource, helmRelease, kustomization, workload } from "./fixtures";

const service = (overrides: Partial<Service>): Service => ({
  name: "api",
  rollingOut: false,
  workloads: [],
  ...overrides,
});

describe("entriesOfVersion", () => {
  it("names services, then syncs, each with what its state means and what its details are of", () => {
    const api = workload("api", "ghcr.io/acme/api:abc");
    const sync: GitOpsSync = { resource: kustomization("apps"), source: gitSource("apps") };

    expect(
      entriesOfVersion(
        [{ name: "api", state: "rolling-out", service: service({ workloads: [api] }) }],
        [{ name: "apps", state: "picked-up", sync }],
      ),
    ).toEqual([
      { name: "api", state: "rolling-out", label: "rolling out", resource: api },
      { name: "apps", state: "picked-up", label: "Kustomization fetched, not applied yet", resource: sync.resource },
    ]);
  });

  it("points a service nothing runs yet to what deploys it", () => {
    const deployer = helmRelease("api");

    expect(entriesOfVersion([{ name: "api", state: "failed", service: service({ deployer }) }])[0].resource).toBe(
      deployer,
    );
  });

  it("is nothing while the cluster is still being read", () => {
    expect(entriesOfVersion(undefined, undefined)).toEqual([]);
  });
});
