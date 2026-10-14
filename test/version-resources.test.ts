import { describe, expect, it } from "vitest";
import type { GitOpsSync } from "../src/deployments/gitops-syncs";
import type { Service } from "../src/deployments/services";
import { resourcesOfVersion } from "../src/deployments/version-resources";
import { gitSource, helmRelease, kustomization, workload } from "./fixtures";

const service = (overrides: Partial<Service>): Service => ({
  name: "api",
  rollingOut: false,
  workloads: [],
  ...overrides,
});

describe("resourcesOfVersion", () => {
  const deployer = helmRelease("api");
  const api = workload("api", "app:1", { replicas: { ready: 2, desired: 2 }, settledAt: "2026-01-01T00:00:00Z" });
  const worker = workload("api-worker", "app:1", { kind: "StatefulSet", replicas: { ready: 0, desired: 1 } });
  const running = service({ workloads: [api, worker], deployer, chart: { applied: "1.4.2" } });

  it("lists each workload of a service, with its pods, age and what deploys it", () => {
    expect(resourcesOfVersion([{ name: "api", state: "running", service: running }])).toEqual([
      {
        id: "Deployment/apps/api",
        name: "api",
        namespace: "apps",
        resource: api,
        state: "running",
        label: "running",
        pods: { ready: 2, desired: 2 },
        settledAt: "2026-01-01T00:00:00Z",
        deployer,
        chart: "1.4.2",
      },
      expect.objectContaining({ id: "StatefulSet/apps/api-worker", pods: { ready: 0, desired: 1 } }),
    ]);
  });

  it("lists a service once, when both its build and its chart are of the version", () => {
    const rows = resourcesOfVersion([
      { name: "api", state: "rolling-out", service: running },
      { name: "api chart", state: "running", service: running },
    ]);

    expect(rows.map((row) => [row.id, row.label])).toEqual([
      ["Deployment/apps/api", "rolling out"],
      ["StatefulSet/apps/api-worker", "rolling out"],
    ]);
  });

  it("lists what deploys a service nothing runs yet, and the syncs applying the version", () => {
    const sync: GitOpsSync = { resource: kustomization("apps"), source: gitSource("apps") };
    const rows = resourcesOfVersion(
      [{ name: "api", state: "picked-up", service: service({ deployer }) }],
      [{ name: "apps", state: "running", sync }],
    );

    expect(rows.map((row) => [row.name, row.resource.kind, row.label, row.pods, row.deployer])).toEqual([
      ["api", "HelmRelease", "picked up by Flux", undefined, undefined],
      ["apps", "Kustomization", "Kustomization applied", undefined, undefined],
    ]);
  });
});
