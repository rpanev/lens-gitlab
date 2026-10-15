import { describe, expect, it } from "vitest";
import {
  changeFailureOf,
  ciFinishedAtOf,
  deployOf,
  type DoraDeploy,
  formatDuration,
  leadLineOf,
  leadTimeOf,
  deploymentReworkOf,
  deploysPerDayOf,
  medianLeadTimeOf,
  medianRestoreOf,
  medianStageOf,
  rememberDeploys,
} from "../src/dora/dora";
import { run } from "./fixtures";

const at = (clock: string) => `2026-10-14T${clock}:00.000Z`;

const deploy = (overrides: Partial<DoraDeploy> & Pick<DoraDeploy, "target" | "versionId" | "committedAt">): DoraDeploy =>
  deployOf({
    repository: "group/app",
    via: "flux",
    versionLabel: overrides.versionId,
    failed: false,
    ...overrides,
  });

describe("lead time", () => {
  it("splits commit to running into CI, Flux and rollout", () => {
    const finished = deploy({
      target: "backend",
      versionId: "76cd335",
      committedAt: at("10:00"),
      ciFinishedAt: at("10:12"),
      appliedAt: at("10:15"),
      runningAt: at("10:18"),
    });

    expect(leadTimeOf(finished)).toBe(18 * 60_000);
    expect(leadLineOf(finished)).toBe("commit ──CI 12m──► image ──Flux 3m──► applied ──rollout 3m──► running");
    expect(formatDuration(40 * 60_000)).toBe("40m");
    expect(formatDuration(2 * 60 * 60_000)).toBe("2h");
  });

  it("names the middle stage Argo CD when Argo applied it", () => {
    const line = leadLineOf(
      deploy({
        target: "backend",
        via: "argo",
        versionId: "abc",
        committedAt: at("10:00"),
        ciFinishedAt: at("10:12"),
        appliedAt: at("10:15"),
        runningAt: at("10:18"),
      }),
    );

    expect(line).toContain("Argo CD 3m");
  });

  it("starts Flux at the pipeline finish once that time is known", () => {
    expect(
      leadLineOf(
        deploy({
          target: "backend",
          versionId: "abc",
          committedAt: at("10:00"),
          ciFinishedAt: at("10:40"),
          appliedAt: at("12:00"),
          runningAt: at("12:03"),
        }),
      ),
    ).toBe("commit ──CI 40m──► image ──Flux 1h 20m──► applied ──rollout 3m──► running");
  });
});

describe("the other weekly figures", () => {
  const now = Date.parse("2026-10-14T18:00:00.000Z");

  it("gives deploys per day, the median of a stage, and the time to the next good deploy", () => {
    const deploys = [
      deploy({
        target: "api",
        versionId: "bad",
        committedAt: at("10:00"),
        runningAt: at("10:10"),
        failed: true,
        failure: "rollout",
      }),
      deploy({
        target: "api",
        versionId: "good",
        committedAt: at("10:20"),
        ciFinishedAt: at("10:32"),
        appliedAt: at("10:35"),
        runningAt: at("10:40"),
      }),
    ];

    expect(deploysPerDayOf(2)).toBeCloseTo(2 / 7);
    expect(medianStageOf(deploys, now, "CI")).toBe(12 * 60_000);
    expect(medianRestoreOf(deploys, now)).toBe(30 * 60_000);
  });
});

describe("change failure", () => {
  const now = Date.parse("2026-10-14T18:00:00.000Z");

  it("is the deploys this week that led to a problem", () => {
    const deploys = [
      ...Array.from({ length: 17 }, (_, index) =>
        deploy({ target: "api", versionId: `ok-${index}`, committedAt: at("09:00"), runningAt: at("11:00") }),
      ),
      deploy({
        target: "api",
        versionId: "stalled",
        committedAt: at("12:00"),
        runningAt: at("12:10"),
        failed: true,
        failure: "rollout",
      }),
      deploy({
        target: "api",
        versionId: "broken",
        committedAt: at("13:00"),
        failed: true,
        failure: "apply",
      }),
      deploy({
        target: "api",
        versionId: "rolled",
        committedAt: at("14:00"),
        runningAt: at("14:20"),
        failed: true,
        failure: "rollback",
      }),
    ];

    expect(changeFailureOf(deploys, now)).toEqual({ failed: 3, total: 20, rate: 0.15 });
  });
});

describe("rememberDeploys", () => {
  const now = Date.parse("2026-10-14T18:00:00.000Z");

  it("keeps a deploy after the cluster moves on, and marks the one a rollback replaced", () => {
    const first = deploy({
      target: "backend",
      versionId: "new",
      versionLabel: "new",
      committedAt: at("11:00"),
      runningAt: at("11:20"),
    });
    const back = deploy({
      target: "backend",
      versionId: "old",
      versionLabel: "old",
      committedAt: at("09:00"),
      runningAt: at("12:00"),
    });

    const remembered = rememberDeploys([], [first], now);
    const after = rememberDeploys(remembered, [back], now);

    expect(after.find((deploy) => deploy.versionId === "new")).toMatchObject({ failed: true, failure: "rollback" });
    expect(after.find((deploy) => deploy.versionId === "old")).toMatchObject({ runningAt: at("12:00"), rework: true });
    expect(deploymentReworkOf(after, now)).toEqual({ rework: 1, total: 2, rate: 0.5 });
  });

  it("blames the deploy a hotfix replaced within a day", () => {
    const shipped = deploy({
      target: "backend",
      versionId: "v1",
      committedAt: at("10:00"),
      runningAt: at("10:20"),
    });
    const fix = deploy({
      target: "backend",
      versionId: "v2",
      versionTitle: "hotfix: tax",
      committedAt: at("11:00"),
      runningAt: at("11:10"),
    });

    const remembered = rememberDeploys([shipped], [fix], now);

    expect(remembered.find((deploy) => deploy.versionId === "v1")).toMatchObject({
      failed: true,
      failure: "hotfix",
    });
    expect(remembered.find((deploy) => deploy.versionId === "v2")).toMatchObject({ rework: true });
    expect(changeFailureOf(remembered, now)).toEqual({ failed: 1, total: 2, rate: 0.5 });
    expect(deploymentReworkOf(remembered, now)).toEqual({ rework: 1, total: 2, rate: 0.5 });
  });

  it("replaces an approximate ReplicaSet time once the rollout is seen to finish", () => {
    const approximate = deploy({
      target: "backend",
      versionId: "abc",
      committedAt: at("10:00"),
      runningAt: at("10:15"),
      approximate: true,
    });
    const finished = deploy({
      target: "backend",
      versionId: "abc",
      committedAt: at("10:00"),
      runningAt: at("10:18"),
      approximate: false,
    });

    expect(rememberDeploys([approximate], [finished], now)[0]).toMatchObject({
      runningAt: at("10:18"),
      approximate: false,
    });
  });
});

describe("ciFinishedAtOf", () => {
  it("is when the last pipeline the commit started had succeeded", () => {
    expect(
      ciFinishedAtOf([
        run("build", "completed", "success", 1),
        { ...run("deploy", "completed", "success", 2), finishedAt: at("10:12") },
        { ...run("mr", "completed", "success", 3), event: "merge_request_event", finishedAt: at("10:40") },
      ]),
    ).toBe(at("10:12"));
  });
});

describe("medianLeadTimeOf", () => {
  it("is the middle commit-to-running of this week", () => {
    const now = Date.parse("2026-10-14T18:00:00.000Z");
    const deploys = [10, 18, 40].map((minutes, index) =>
      deploy({
        target: "api",
        versionId: String(index),
        committedAt: at("08:00"),
        runningAt: new Date(Date.parse(at("08:00")) + minutes * 60_000).toISOString(),
      }),
    );

    expect(medianLeadTimeOf(deploys, now)).toBe(18 * 60_000);
  });
});
