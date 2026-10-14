import { describe, expect, it } from "vitest";
import { clusterStatusReadingOf, projectPipelinesReadingOf, watchedMatching } from "../src/ask-ai/reading";
import type { VersionRow } from "../src/dashboard/watch-on-cluster.injectable";
import { commit, run } from "./fixtures";
import type { WatchedRepository } from "../src/watched-repositories/watched-repository";

const watch: WatchedRepository = { repository: "group/app", branch: "main", intervalMinutes: 5 };

describe("clusterStatusReadingOf", () => {
  it("says the list is still being read", () => {
    expect(clusterStatusReadingOf(undefined, { state: "checking", message: "Checking GitLab and the cluster…" })).toMatchObject({
      ready: false,
      state: null,
      projects: [],
    });
  });

  it("says nothing is watched, rather than that nothing is deployed", () => {
    expect(clusterStatusReadingOf([], { state: "nothing-deployed", message: "Nothing in this cluster runs a build of what is watched." })).toEqual({
      ready: true,
      state: "not-configured",
      label: "Not configured",
      message: "No GitLab project is watched on this cluster.",
      projects: [],
    });
  });

  it("returns the banner and the watches", () => {
    const reading = clusterStatusReadingOf([watch], { state: "up-to-date", message: "Every service runs the latest version." });

    expect(reading).toMatchObject({
      ready: true,
      state: "up-to-date",
      label: "Up to date",
      projects: [{ project: "group/app", follows: "main", host: "gitlab.com", notify: "all" }],
    });
  });
});

describe("watchedMatching", () => {
  it("matches a project apart from case, and a named follow", () => {
    const other: WatchedRepository = { ...watch, branch: "develop" };

    expect(watchedMatching([watch, other], "Group/App").watches).toHaveLength(2);
    expect(watchedMatching([watch, other], "group/app", undefined, "develop").watches).toEqual([other]);
    expect(watchedMatching([watch], "group/other")).toMatchObject({ error: expect.stringContaining("not watched") });
  });
});

describe("projectPipelinesReadingOf", () => {
  const version = commit("76cd335");
  const row: VersionRow = {
    version,
    runs: [run("build", "completed", "failure", 7)],
    otherRuns: [],
    services: [],
    syncs: [],
  };

  it("names a failed pipeline and an unread cluster", () => {
    const reading = projectPipelinesReadingOf(watch, { status: "loading" }, { status: "loading" }, [row]);

    expect(reading.gitlab).toBe("checking");
    expect(reading.versions).toEqual([]);

    const loaded = projectPipelinesReadingOf(
      watch,
      { status: "loaded", versions: [version], recent: [row], checkedAt: new Date(), mode: "idle" },
      { status: "failed", message: "connection refused" },
      [row],
    );

    expect(loaded).toMatchObject({
      gitlab: "loaded",
      cluster: "unreachable",
      clusterProblem: "connection refused",
      versions: [{ label: version.label, pipelineStatus: "Failed", pipelineSummary: "0/1 pipeline passed" }],
    });
  });
});
