import { describe, expect, it } from "vitest";
import { formatAge } from "../src/dashboard/format-time-ago";
import { overallStatusOf, runStatusOf } from "../src/pipelines/run-status";
import { shellQuote } from "../src/pipelines/shell-quote";
import { trackSourcesInjectable } from "../src/pipelines/track-sources.injectable";
import { toVersionRuns } from "../src/pipelines/version";
import { runsOfCommitWith } from "../src/pipelines/pipeline";
import { commit, run } from "./fixtures";

describe("runStatusOf", () => {
  it.each([
    ["in_progress", "", "In progress"],
    ["queued", "", "Queued"],
    ["completed", "success", "Success"],
    ["completed", "failure", "Failed"],
    ["completed", "startup_failure", "Failed"],
    ["completed", "timed_out", "Timed out"],
    ["completed", "action_required", "Action required"],
    ["completed", "cancelled", "Cancelled"],
    ["completed", "skipped", "Skipped"],
    ["manual", "", "Manual"],
  ])("%s / %s → %s", (status, conclusion, label) => {
    expect(runStatusOf(run("build", status, conclusion)).label).toBe(label);
  });
});

describe("overallStatusOf", () => {
  it("shows what most needs attention", () => {
    const success = run("a");
    const failed = run("b", "completed", "failure");
    const running = run("c", "in_progress", "");

    expect(overallStatusOf([success, success]).label).toBe("Success");
    expect(overallStatusOf([success, failed]).label).toBe("Failed");
    expect(overallStatusOf([success, failed, running]).label).toBe("In progress");
  });
});

describe("toVersionRuns", () => {
  it("keeps the newest run of each pipeline, by name", () => {
    const newest = [
      run("tests", "completed", "success", 3),
      run("build", "completed", "success", 2),
      run("tests", "completed", "failure", 1),
    ];

    const { runs } = toVersionRuns(commit("abc"), newest);

    expect(runs.map((each) => [each.name, each.databaseId])).toEqual([
      ["build", 2],
      ["tests", 3],
    ]);
  });
});

describe("toVersionRuns, what a version started", () => {
  it("keeps apart the pipelines the commit did not start, such as a merge request's", () => {
    const { runs, otherRuns } = toVersionRuns(commit("abc"), [
      { ...run("build"), event: "push" },
      { ...run("Merge request", "completed", "failure", 2), event: "merge_request_event" },
      { ...run("nightly", "completed", "success", 3), event: "schedule" },
      { ...run("deploy", "completed", "success", 4), event: "web" },
    ]);

    // A scheduled run builds the commit the branch is at, so it counts.
    expect(runs.map((each) => each.name)).toEqual(["build", "deploy", "nightly"]);
    expect(otherRuns.map((each) => each.name)).toEqual(["Merge request"]);
    expect(overallStatusOf(runs).label).toBe("Success");
  });
});

describe("shellQuote", () => {
  it.each([
    ["main", "'main'"],
    ["feature/x y", "'feature/x y'"],
    ["it's", `'it'\\''s'`],
    ["$(rm -rf /)", "'$(rm -rf /)'"],
  ])("%s → %s", (value, expected) => {
    expect(shellQuote(value)).toBe(expected);
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");

  it.each([
    ["2026-10-02T11:59:30Z", "now"],
    ["2026-10-02T11:55:00Z", "5m"],
    ["2026-10-02T09:00:00Z", "3h"],
    ["2026-09-29T12:00:00Z", "3d"],
    ["2026-10-02T12:05:00Z", "now"], // a clock slightly behind is not the future
  ])("%s → %s", (at, expected) => {
    expect(formatAge(at, now)).toBe(expected);
  });
});

describe("releases and their pipelines", () => {
  const sha = "05c6a4f".padEnd(40, "0");
  const releases = JSON.stringify([
    {
      tag_name: "v1.2.0",
      name: "v1.2.0",
      released_at: "2026-10-01T08:00:00Z",
      upcoming_release: false,
      commit: { id: sha, title: "chore(main): release 1.2.0" },
    },
  ]);
  const pipeline = (name: string, ref: string, status = "success") => ({
    id: name.length + ref.length,
    name,
    ref,
    sha,
    source: "push",
    status,
    web_url: `https://gitlab.com/o/app/-/pipelines/${name.length + ref.length}`,
  });

  const sourceRunning = (pipelines: object[], defaultBranch = async () => "main", latest: object[] = pipelines) => {
    let latestAsked = 0;
    let shaAsked = 0;
    const glab = async (_host: string, path: string) => {
      if (path.startsWith("graphql?")) {
        latestAsked++;

        return JSON.stringify({
          data: {
            project: {
              pipelines: {
                nodes: latest.map((pipeline) => {
                  const each = pipeline as {
                    id: number;
                    sha: string;
                    ref: string;
                    status: string;
                    source: string;
                    name?: string;
                  };

                  return {
                    id: `gid://gitlab/Ci::Pipeline/${each.id}`,
                    sha: each.sha,
                    ref: each.ref,
                    status: each.status.toUpperCase(),
                    source: each.source,
                    name: each.name,
                  };
                }),
              },
            },
          },
        });
      }
      if (path.includes("/pipelines?") && path.includes("sha=")) {
        shaAsked++;

        return JSON.stringify(pipelines);
      }
      if (path.includes("/releases?")) return releases;
      if (path.includes("/repository/commits/")) return JSON.stringify({ id: sha, title: "chore(main): release 1.2.0" });
      if (!path.replace(/^projects\/[^/]+/, "").includes("/")) return defaultBranch().then((name) => JSON.stringify({ default_branch: name }));
      throw new Error(`unexpected ${path}`);
    };

    const source = (trackSourcesInjectable as any).instantiate({ inject: () => () => glab })()({
      repository: "o/app",
      track: "releases",
      branch: "",
      intervalMinutes: 5,
    });

    return Object.assign(source, { latestAsked: () => latestAsked, shaAsked: () => shaAsked });
  };

  it("shows runs that asking by commit misses yet, from the repository's latest runs", async () => {
    const source = sourceRunning([], undefined, [pipeline("release", "v1.2.0")]);
    const { recent } = await source.all();

    expect(recent[0].runs.map((each: { name: string }) => each.name)).toEqual(["release"]);
  });

  it("matches a commit from the latest pipelines without asking for it again", async () => {
    const source = sourceRunning([pipeline("release", "v1.2.0")]);

    await source.all();

    expect(source.shaAsked()).toBe(0);
  });

  it("asks for a commit's pipelines only when that commit is not among the latest", async () => {
    const source = sourceRunning([pipeline("release", "v1.2.0")], undefined, []);

    await source.all();

    expect(source.shaAsked()).toBe(1);
    expect(source.latestAsked()).toBe(1);
  });

  it("reuses the latest pipelines for another check of the same project", async () => {
    const source = sourceRunning([pipeline("release", "v1.2.0")]);

    await source.all();
    await Promise.all([source.runsOf((await source.all()).versions[0]), source.all()]);

    expect(source.latestAsked()).toBe(1);
  });

  it("asks once for the latest pipelines when versions are rechecked together", async () => {
    const source = sourceRunning([pipeline("release", "v1.2.0")]);
    const version = {
      id: "v1.2.0",
      label: "v1.2.0",
      title: "v1.2.0",
      at: "2026-10-01T08:00:00Z",
      url: "https://gitlab.com/o/app/-/releases/v1.2.0",
    };

    await Promise.all([source.runsOf(version), source.runsOf(version)]);

    expect(source.latestAsked()).toBe(1);
  });

  it("shows a release's own runs when its tag started some", async () => {
    const { recent } = await sourceRunning([pipeline("release", "v1.2.0"), pipeline("ci", "main")]).all();

    expect(recent[0].runs.map((each: { name: string }) => each.name)).toEqual(["release"]);
    expect(recent[0].runsOn).toBeUndefined();
  });

  it("shows the tagged commit's runs on the default branch when the tag started none", async () => {
    const { recent } = await sourceRunning([
      pipeline("ci", "main", "failed"),
      pipeline("CodeQL", "main"),
      pipeline("tests", "feature-x"),
    ]).all();

    expect(recent[0].runs.map((each: { name: string }) => each.name)).toEqual(["ci", "CodeQL"]);
    expect(recent[0].runsOn).toBe("main");
  });

  it("fails, to be asked again, when the default branch could not be read, rather than show no runs", async () => {
    let calls = 0;
    const source = sourceRunning([pipeline("ci", "main")], async () => {
      if (calls++ === 0) throw new Error("glab: connection reset");

      return "main";
    });

    await expect(source.all()).rejects.toThrow("connection reset");

    const { recent } = await source.all();

    expect(recent[0].runs.map((each: { name: string }) => each.name)).toEqual(["ci"]);
    expect(recent[0].runsOn).toBe("main");
  });

  it("shows nothing when the commit only has runs of pull requests", async () => {
    const { recent } = await sourceRunning([pipeline("tests", "feature-x")]).all();

    expect(recent[0].runs).toEqual([]);
    expect(recent[0].runsOn).toBeUndefined();
  });

  it("shows nothing when the commit has no runs at all", async () => {
    const { recent } = await sourceRunning([]).all();

    expect(recent[0].runs).toEqual([]);
    expect(recent[0].runsOn).toBeUndefined();
  });
});

describe("runsOfCommitWith", () => {
  const sha = "a".repeat(40);
  const of = (id: number, headSha = sha) => ({ ...run("ci", "completed", "success", id), headSha });

  it("adds the commit's runs among the latest, which asking by commit can miss for a while", () => {
    expect(runsOfCommitWith(sha, [], [of(9), of(8, "b".repeat(40)), of(7)]).map((each) => each.databaseId)).toEqual([
      9, 7,
    ]);
  });

  it("counts a run both answers have once, newest first", () => {
    expect(runsOfCommitWith(sha, [of(3), of(1)], [of(5), of(3)]).map((each) => each.databaseId)).toEqual([5, 3, 1]);
  });
});
