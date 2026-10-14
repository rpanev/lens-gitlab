import { describe, expect, it } from "vitest";
import { imageIsOfCommit, imageIsOfRelease } from "../src/deployments/cluster-images";
import { type ImageMatches, servicesOf, versionsRunningOf } from "../src/deployments/services";
import { servicesOfVersion } from "../src/deployments/version-services";
import { serviceLookOf, serviceStatusOf } from "../src/dashboard/flux-stage";
import { cluster, commit, helmChart, helmRelease, release, sha, workload } from "./fixtures";

const byCommit: ImageMatches = (image, version) => imageIsOfCommit(image, version.id);
const byTag: ImageMatches = (image, version) => imageIsOfRelease(image, version.id);

const commits = [
  commit("aaaaaaa", "2026-10-01T10:00:00Z"),
  commit("bbbbbbb", "2026-10-01T09:00:00Z"),
  commit("ccccccc", "2026-10-01T08:00:00Z"),
];

const owner = { kind: "HelmRelease" as const, namespace: "apps", name: "backend" };

describe("servicesOf", () => {
  it("names services after their images and says how far behind each runs", () => {
    const services = servicesOf(
      commits,
      byCommit,
      cluster({
        workloads: [
          workload("backend", "registry/lens-cloud-backend:main-aaaaaaa"),
          workload("frontend", "registry/lens-cloud-frontend:main-ccccccc"),
          workload("unrelated", "quay.io/k8slens/bored:0.10.4"),
        ],
      }),
    );

    expect(services.map((service) => [service.name, service.running?.label, service.running?.behind])).toEqual([
      ["lens-cloud-backend", "aaaaaaa", 0],
      ["lens-cloud-frontend", "ccccccc", 2],
    ]);
    expect(versionsRunningOf(services)).toBe(2);
  });

  it("puts a service at its oldest version, and its workloads once each", () => {
    const [service] = servicesOf(
      commits,
      byCommit,
      cluster({
        workloads: [
          workload("backend", "r/backend:main-aaaaaaa"),
          workload("worker", "r/backend:main-bbbbbbb", { rolledOut: false }),
        ],
      }),
    );

    expect(service.running?.label).toBe("bbbbbbb");
    expect(service.workloads).toHaveLength(2);
    expect(service.rollingOut).toBe(true);
  });

  it("matches releases by tag", () => {
    const [service] = servicesOf(
      [release("v2026.9.3-rc.1"), release("v2026.9.2")],
      byTag,
      cluster({ workloads: [workload("backend", "r/lens-cloud-backend:v2026.9.2")] }),
    );

    expect([service.running?.label, service.running?.behind]).toEqual(["v2026.9.2", 1]);
  });

  describe("Flux image automation", () => {
    const pickedUp = (overrides: { pushedAt?: string; fluxState?: "ready" | "reconciling" | "failed" }) =>
      servicesOf(
        commits,
        byCommit,
        cluster({
          workloads: [workload("backend", "r/backend:main-bbbbbbb", { owner })],
          imageSelections: [{ namespace: "flux-system", name: "backend", image: "r/backend:main-aaaaaaa" }],
          imageAutomations: [{ namespace: "flux-system", name: "flux-system", lastPushTime: overrides.pushedAt }],
          deployResources: [helmRelease("backend", { state: overrides.fluxState ?? "ready" })],
        }),
      )[0];

    it.each([
      [
        "selected, not pushed since the commit",
        { pushedAt: "2026-10-01T09:30:00Z" },
        "selected",
        "aaaaaaa selected by Flux",
      ],
      [
        "committed once pushed after it",
        { pushedAt: "2026-10-01T10:05:00Z" },
        "committed",
        "aaaaaaa committed by Flux",
      ],
      [
        "applying while the owner reconciles",
        { pushedAt: "2026-10-01T10:05:00Z", fluxState: "reconciling" as const },
        "applying",
        "Flux applying aaaaaaa",
      ],
      [
        "failed when the owner failed",
        { pushedAt: "2026-10-01T10:05:00Z", fluxState: "failed" as const },
        "failed",
        "Flux failed to apply aaaaaaa",
      ],
    ])("%s", (_, overrides, stage, status) => {
      const service = pickedUp(overrides);

      expect(service.pickedUp?.stage).toBe(stage);
      expect(serviceStatusOf({ ...service, unit: "commit" })).toBe(status);
    });

    it("ignores a selection no newer than what runs", () => {
      const [service] = servicesOf(
        commits,
        byCommit,
        cluster({
          workloads: [workload("backend", "r/backend:main-aaaaaaa")],
          imageSelections: [{ namespace: "flux-system", name: "backend", image: "r/backend:main-bbbbbbb" }],
        }),
      );

      expect(service.pickedUp).toBeUndefined();
    });
  });

  describe("Helm charts", () => {
    const withChart = (chart: {
      version?: string;
      attempted?: string;
      fluxState?: "ready" | "reconciling" | "failed";
    }) =>
      servicesOf(
        commits,
        byCommit,
        cluster({
          workloads: [workload("backend", "r/backend:main-aaaaaaa", { owner })],
          deployResources: [
            helmRelease("backend", {
              state: chart.fluxState ?? "ready",
              chart: {
                helmChart: "flux-system/apps-backend",
                applied: "0.1.161",
                attempted: chart.attempted ?? "0.1.161",
              },
            }),
          ],
          helmCharts: [
            helmChart("apps-backend", { version: chart.version ?? "0.1.161", sourceCommit: sha("bbbbbbb") }),
          ],
        }),
      )[0];

    it("names the chart installed and the commit it was built from", () => {
      const { chart } = withChart({});

      expect(chart).toMatchObject({ applied: "0.1.161", pending: undefined, sourceCommit: sha("bbbbbbb") });
      expect(chart?.source?.behind).toBe(1);
    });

    it.each([
      [
        "waiting once Flux built a newer one",
        { version: "0.1.162" },
        "Chart 0.1.162 waiting to install",
        "progressing",
      ],
      [
        "upgrading while the HelmRelease reconciles",
        { version: "0.1.162", fluxState: "reconciling" as const },
        "Upgrading chart to 0.1.162",
        "progressing",
      ],
      [
        "failed when installing it failed",
        { version: "0.1.162", attempted: "0.1.162", fluxState: "failed" as const },
        "Chart 0.1.162 failed to install",
        "failed",
      ],
    ])("%s", (_, chart, status, look) => {
      const service = withChart(chart);

      expect(serviceStatusOf({ ...service, unit: "commit" })).toBe(status);
      expect(serviceLookOf(service)).toBe(look);
    });

    it("lists the chart under the commit it was built from", () => {
      const services = [withChart({})];

      expect(servicesOfVersion(sha("aaaaaaa"), services).map((each) => [each.name, each.state])).toEqual([
        ["backend", "running"],
      ]);
      expect(servicesOfVersion(sha("bbbbbbb"), services).map((each) => [each.name, each.state])).toEqual([
        ["backend chart", "running"],
      ]);
    });
  });
});

describe("serviceStatusOf", () => {
  const [latest, behind] = servicesOf(
    commits,
    byCommit,
    cluster({ workloads: [workload("a", "r/a:aaaaaaa"), workload("b", "r/b:ccccccc")] }),
  );

  it.each([
    [latest, "commit", "Latest", "latest"],
    [behind, "commit", "2 commits behind", "behind"],
    [behind, "release", "2 releases behind", "behind"],
  ] as const)("%#: %s", (service, unit, status, look) => {
    expect(serviceStatusOf({ ...service, unit })).toBe(status);
    expect(serviceLookOf(service)).toBe(look);
  });
});
