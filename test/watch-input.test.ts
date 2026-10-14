import { describe, expect, it } from "vitest";
import type { WatchedRepository } from "../src/watched-repositories/watched-repository";
import { planSaveWatch } from "../src/watched-repositories/watch-input";

const main: WatchedRepository = {
  repository: "group/app",
  track: "branch",
  branch: "main",
  intervalMinutes: 5,
  notify: "all",
};

const releases: WatchedRepository = {
  repository: "group/app",
  track: "releases",
  branch: "",
  includePrereleases: true,
  tagPattern: "v*",
  intervalMinutes: 15,
  notify: "failures",
};

describe("planSaveWatch", () => {
  it("watches a project on main at gitlab.com", () => {
    const plan = planSaveWatch([], { project: "group/app" });

    expect(plan).toEqual({
      action: "add",
      watch: { host: undefined, repository: "group/app", track: "branch", branch: "main", intervalMinutes: 5, notify: "all" },
    });
  });

  it("reads a pasted project URL as the host and the path", () => {
    const plan = planSaveWatch([], { project: "https://gitlab.example.com/group/team/app.git", branch: "release" });

    expect(plan).toMatchObject({
      action: "add",
      watch: { host: "gitlab.example.com", repository: "group/team/app", branch: "release" },
    });
  });

  it("keeps the interval and the notifications when only the branch changes", () => {
    const plan = planSaveWatch([{ ...main, intervalMinutes: 30, notify: "off" }], { project: "group/app", branch: "develop" });

    expect(plan).toMatchObject({
      action: "replace",
      watch: { branch: "develop", intervalMinutes: 30, notify: "off" },
    });
  });

  it("changes the one watch of a project from a branch to releases", () => {
    const plan = planSaveWatch([main], { project: "Group/App", track: "releases", tagPattern: "v*" });

    expect(plan).toMatchObject({
      action: "replace",
      previous: main,
      watch: { track: "releases", includePrereleases: true, tagPattern: "v*", branch: "" },
    });
  });

  it("adds a second follow when the project is already watched twice", () => {
    const plan = planSaveWatch([main, releases], { project: "group/app", branch: "develop" });

    expect(plan).toMatchObject({ action: "add", watch: { branch: "develop" } });
  });

  it("updates the matching follow when the project is watched more than once", () => {
    const plan = planSaveWatch([main, releases], { project: "group/app", branch: "main", intervalMinutes: 1 });

    expect(plan).toMatchObject({ action: "replace", previous: main, watch: { branch: "main", intervalMinutes: 1 } });
  });

  it("asks which watch, when the project is watched more than once and none was named", () => {
    expect(planSaveWatch([main, releases], { project: "group/app", intervalMinutes: 60 })).toEqual({
      action: "error",
      message: "group/app is watched as main, releases and pre-releases matching v*. Say which one.",
    });
  });

  it("stops the only watch, and the named one of several", () => {
    expect(planSaveWatch([main], { project: "group/app", stop: true })).toMatchObject({ action: "remove", watch: main });
    expect(planSaveWatch([main, releases], { project: "group/app", follows: undefined, track: "releases", stop: true })).toMatchObject({
      action: "remove",
      watch: releases,
    });
  });

  it("does not stop a different follow than the one named", () => {
    expect(planSaveWatch([main], { project: "group/app", branch: "develop", stop: true })).toMatchObject({
      action: "error",
    });
  });

  it("refuses a project path, a host, an interval or a branch that cannot be saved", () => {
    expect(planSaveWatch([], { project: "app" }).action).toBe("error");
    expect(planSaveWatch([], { project: "group/app", host: "not a host" }).action).toBe("error");
    expect(planSaveWatch([], { project: "group/app", intervalMinutes: 10 }).action).toBe("error");
    expect(planSaveWatch([], { project: "group/app", branch: "  " }).action).toBe("error");
  });
});
