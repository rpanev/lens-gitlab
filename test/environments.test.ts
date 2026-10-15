import { describe, expect, it } from "vitest";
import {
  clusterForEnvironment,
  deploymentsPathOf,
  driftRangeOf,
  environmentDriftOf,
  latestDeploymentsOf,
  sameEnvironment,
} from "../src/pipelines/environments";

const sha = (prefix: string) => prefix.padEnd(40, "b");

describe("latestDeploymentsOf", () => {
  it("keeps the newest successful deployment of each environment", () => {
    const newest = sha("aaa");
    const older = sha("ccc");

    expect(
      latestDeploymentsOf([
        { status: "success", sha: newest, ref: "v1.4.0", environment: { name: "production" } },
        { status: "success", sha: older, ref: "v1.3.0", environment: { name: "production" } },
        { status: "failed", sha: sha("ddd"), environment: { name: "staging" } },
        { status: "success", sha: sha("eee"), ref: "main", environment: { name: "staging" } },
      ]),
    ).toEqual([
      { environment: "production", sha: newest, ref: "v1.4.0" },
      { environment: "staging", sha: sha("eee"), ref: "main" },
    ]);
  });
});

describe("environmentDriftOf", () => {
  it("calls it drift when GitLab and the cluster of the same name differ", () => {
    const deployed = sha("aaa");
    const running = sha("bbb");
    const rows = environmentDriftOf(
      [
        { environment: "production", sha: deployed, ref: "v1.4.0" },
        { environment: "review/foo", sha: sha("ccc"), ref: "v9" },
      ],
      [{ name: "prod-eu", runningId: running, runningLabel: "bbbbbbb" }],
      [{ id: deployed, label: "v1.4.0" }],
    );

    expect(sameEnvironment("prod-eu", "production")).toBe(true);
    expect(rows[0]).toMatchObject({ gitlab: "v1.4.0", clusterName: "prod-eu", running: "bbbbbbb", drift: true });
    expect(rows[1]).toMatchObject({ clusterName: undefined, drift: false });
  });

  it("matches production to the open cluster when it follows main, master or prod", () => {
    expect(
      clusterForEnvironment("production", [
        { name: "centsight-demo-gke", branch: "demo", current: false },
        { name: "centsight-gke", branch: "main", current: true, runningId: "abc", runningLabel: "abc1234" },
      ])?.name,
    ).toBe("centsight-gke");
    expect(clusterForEnvironment("production", [{ name: "prod-eu", branch: "release" }])?.name).toBe("prod-eu");
    expect(
      clusterForEnvironment("production", [
        { name: "centsight-demo-gke", branch: "demo", current: true },
        { name: "centsight-gke", branch: "master" },
      ])?.name,
    ).toBe("centsight-gke");
    expect(clusterForEnvironment("dev", [{ name: "centsight-gke", branch: "main", current: true }])).toBeUndefined();
  });

  it("compares from the older commit to the newer", () => {
    const older = sha("aaa");
    const newer = sha("bbb");

    expect(driftRangeOf(older, newer, [{ id: newer }, { id: older }])).toEqual({ from: older, to: newer });
    expect(driftRangeOf(newer, older, [{ id: newer }, { id: older }])).toEqual({ from: older, to: newer });
  });

  it("matches a short commit id to the deployed sha", () => {
    const deployed = sha("abc1234");

    expect(
      environmentDriftOf(
        [{ environment: "development", sha: deployed }],
        [{ name: "dev", runningId: "abc1234", runningLabel: "abc1234" }],
        [],
      )[0],
    ).toMatchObject({ drift: false, gitlab: "abc1234" });
  });
});

describe("deploymentsPathOf", () => {
  it("asks for the latest successful deployments", () => {
    expect(deploymentsPathOf("group/app")).toBe(
      "projects/group%2Fapp/deployments?status=success&order_by=id&sort=desc&per_page=100",
    );
  });
});
