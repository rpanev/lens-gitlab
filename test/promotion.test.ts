import { describe, expect, it } from "vitest";
import { byEnvironment, environmentRankOf, placeOf } from "../src/deployments/promotion";

const place = (label: string, behind: number) => ({ id: label, label, behind });

describe("environmentRankOf", () => {
  it("orders a name by dev, then stage, then prod", () => {
    expect(["prod-eu", "qa", "development", "sandbox"].sort(byEnvironment)).toEqual([
      "development",
      "qa",
      "prod-eu",
      "sandbox",
    ]);
    expect(environmentRankOf("production")).toBe(2);
  });
});

describe("placeOf", () => {
  it("names the oldest version the services run", () => {
    expect(
      placeOf(
        [{ running: place("abc1234", 2) }, { running: place("def5678", 0) }],
        [{ applied: place("1111111", 4) }],
      ),
    ).toEqual({ place: place("abc1234", 2), detail: "2 services, 2 versions" });
  });

  it("uses an applied commit when the cluster runs no image of the project", () => {
    expect(placeOf([], [{ applied: place("abc1234", 1) }])).toEqual({
      place: place("abc1234", 1),
      detail: "1 sync",
    });
  });

  it("says when nothing of the project is running", () => {
    expect(placeOf([{ running: undefined }], [])).toEqual({ detail: "nothing running" });
  });
});
