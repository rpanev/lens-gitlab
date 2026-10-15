import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchKeyOf } from "../src/watched-repositories/watched-repository";
import { trackActivityInjectable } from "../src/pipelines/track-activity.injectable";
import { commit, run } from "./fixtures";

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("checking when glab fails", () => {
  let failure: string | undefined;
  let calls = 0;

  const source = {
    headOf: async () => {
      calls++;
      if (failure) throw new Error(failure);
      return commit("aaaaaaa").id;
    },
    all: async () => {
      calls++;
      if (failure) throw new Error(failure);
      return { versions: [commit("aaaaaaa")], recent: [{ version: commit("aaaaaaa"), runs: [] }] };
    },
    runsOf: async (version: ReturnType<typeof commit>) => ({ version, runs: [] }),
  };

  const activityOf = () =>
    (trackActivityInjectable as any).instantiate({ inject: () => () => () => source })(
      watchKeyOf({ repository: "o/app", branch: "main", intervalMinutes: 5 }),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    calls = 0;
  });

  afterEach(() => vi.useRealTimers());

  it("shares one check across clusters watching the same project", async () => {
    failure = undefined;
    const factory = (trackActivityInjectable as any).instantiate({ inject: () => () => () => source });
    const key = watchKeyOf({ repository: "o/app", branch: "main", intervalMinutes: 5 });
    const dev = factory(key);
    const prod = factory(key);

    expect(prod).toBe(dev);
    dev.watch();
    prod.watch();
    await settle();

    expect(calls).toBe(1);
  });

  it("pauses while glab is signed out, and resumes when checked again", async () => {
    failure = "fatal: not authenticated. please run `glab auth login`";
    const activity = activityOf();

    activity.watch();
    await settle();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(activity.state.problem.cause).toBe("not-signed-in");
    expect(calls).toBe(1);

    failure = undefined;
    await activity.refresh();
    await vi.advanceTimersByTimeAsync(61_000);

    expect(activity.state.status).toBe("loaded");
    expect(calls).toBeGreaterThan(2);
  });

  it("checks again when something new follows a paused watch", async () => {
    failure = "glab: invalid_token (HTTP 401)";
    const activity = activityOf();

    activity.watch();
    await settle();
    failure = undefined;
    activity.watch();
    await settle();

    expect(activity.state.status).toBe("loaded");
  });

  it("keeps checking while GitLab cannot be reached", async () => {
    failure = undefined;
    const activity = activityOf();

    activity.watch();
    await settle();
    failure = "error connecting to gitlab.com";
    await vi.advanceTimersByTimeAsync(61_000);
    const callsWhileOffline = calls;
    await vi.advanceTimersByTimeAsync(61_000);

    expect(activity.state.warning?.cause).toBe("offline");
    expect(calls).toBeGreaterThan(callsWhileOffline);
  });
});

describe("versions GitLab said have no pipelines", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("are asked again every few minutes between full checks, as the answer may have been wrong", async () => {
    const version = commit("aaaaaaa");
    let runsOfCalls = 0;
    const source = {
      headOf: async () => version.id,
      all: async () => ({ versions: [version], recent: [{ version, runs: [], otherRuns: [] }] }),
      runsOf: async () => {
        runsOfCalls++;

        return { version, runs: [run("ci")], otherRuns: [] };
      },
    };
    const activity = (trackActivityInjectable as any).instantiate({ inject: () => () => () => source })(
      watchKeyOf({ repository: "o/app", branch: "main", intervalMinutes: 60 }),
    );

    activity.watch();
    await settle();
    await vi.advanceTimersByTimeAsync(4 * 60_000);

    expect(runsOfCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(2 * 60_000);

    expect(runsOfCalls).toBe(1);
    expect(activity.state.recent[0].runs).toHaveLength(1);
  });
});
