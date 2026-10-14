import { describe, expect, it } from "vitest";
import {
  followedLabelOf,
  isSameWatch,
  tagMatches,
  type WatchedRepository,
  watchKeyOf,
  watchOfKey,
} from "../src/watched-repositories/watched-repository";

describe("tagMatches", () => {
  it.each([
    ["v*", "v0.13.0", true],
    ["v*", "artifact-contract/v0.2.0", false], // the whole tag has to match
    ["artifact-contract/v*", "artifact-contract/v0.2.0", true],
    ["artifact-contract/v*", "v0.13.0", false],
    ["v2026.9.*", "v2026.9.3-rc.1", true],
    ["v2026.9.*", "v2026.10.1", false], // the dot is a dot
    ["v1.(2)+", "v1.(2)+", true], // regex characters are themselves
    ["v1.(2)+", "v1.22", false],
    [undefined, "anything", true],
    ["", "anything", true],
  ])("%s on %s → %s", (pattern, tag, expected) => {
    expect(tagMatches(pattern, tag)).toBe(expected);
  });
});

const branchWatch: WatchedRepository = { repository: "lensapp/lenscloud", branch: "main", intervalMinutes: 5 };
const releasesWatch: WatchedRepository = {
  repository: "lensapp/lenscloud",
  track: "releases",
  branch: "",
  includePrereleases: true,
  tagPattern: "v*",
  intervalMinutes: 5,
};

describe("isSameWatch", () => {
  it("tells watches apart by repository, case aside, and what they follow", () => {
    expect(isSameWatch(branchWatch, { ...branchWatch, repository: "LensApp/LensCloud", intervalMinutes: 15 })).toBe(
      true,
    );
    expect(isSameWatch(branchWatch, { ...branchWatch, branch: "release/v2026.9" })).toBe(false);
    expect(isSameWatch(releasesWatch, { ...releasesWatch, tagPattern: "artifact-contract/v*" })).toBe(false);
    expect(isSameWatch(releasesWatch, { ...releasesWatch, includePrereleases: false })).toBe(false);
  });

  it("takes a watch saved before releases for a branch watch", () => {
    expect(isSameWatch(branchWatch, { ...branchWatch, track: "branch" })).toBe(true);
  });
});

describe("followedLabelOf", () => {
  it.each([
    [branchWatch, "main"],
    [{ ...releasesWatch, tagPattern: undefined }, "releases and pre-releases"],
    [{ ...releasesWatch, includePrereleases: false, tagPattern: undefined }, "releases"],
    [releasesWatch, "releases and pre-releases matching v*"],
  ])("%#", (watch, expected) => {
    expect(followedLabelOf(watch)).toBe(expected);
  });
});

describe("watchKeyOf", () => {
  it("keeps every setting through a round trip", () => {
    expect(watchOfKey(watchKeyOf(releasesWatch))).toEqual(releasesWatch);
    expect(watchOfKey(watchKeyOf({ ...branchWatch, track: "branch" }))).toMatchObject({
      repository: "lensapp/lenscloud",
      branch: "main",
      intervalMinutes: 5,
    });
  });

  it("differs for any setting that differs", () => {
    const keys = new Set(
      [
        branchWatch,
        { ...branchWatch, intervalMinutes: 15 },
        releasesWatch,
        { ...releasesWatch, tagPattern: "x*" },
        { ...releasesWatch, includePrereleases: false },
      ].map(watchKeyOf),
    );

    expect(keys.size).toBe(5);
  });
});
