import { describe, expect, it } from "vitest";
import { opensByDefault } from "../src/pipelines/run-status";
import { summaryOf, pipelinesPassingOf } from "../src/pipelines/version";
import { run } from "./fixtures";

describe("summaryOf", () => {
  it("counts the pipelines that passed, with the status asking most for attention", () => {
    const summary = summaryOf({ runs: [run("ci"), run("deploy", "completed", "failure", 2)] });

    expect(summary.text).toBe("1/2 pipelines passed");
    expect(summary.status?.label).toBe("Failed");
  });

  it("says one pipeline, and has no status without runs", () => {
    expect(summaryOf({ runs: [run("ci")] }).text).toBe("1/1 pipeline passed");
    expect(summaryOf({ runs: [] })).toEqual({ text: "No pipelines of its own", status: undefined });
  });
});

describe("opensByDefault", () => {
  it("folds what succeeded or was skipped", () => {
    expect(opensByDefault(run("ci"))).toBe(false);
    expect(opensByDefault(run("ci", "completed", "skipped"))).toBe(false);
  });

  it("opens what failed, was cancelled or still runs", () => {
    expect(opensByDefault(run("ci", "completed", "failure"))).toBe(true);
    expect(opensByDefault(run("ci", "completed", "cancelled"))).toBe(true);
    expect(opensByDefault(run("ci", "in_progress", ""))).toBe(true);
  });
});

describe("pipelinesPassingOf", () => {
  it("counts the versions that passed of those that ran any pipeline", () => {
    expect(
      pipelinesPassingOf([
        { runs: [run("ci")] },
        { runs: [run("ci"), run("e2e", "completed", "failure", 2)] },
        { runs: [] },
      ]),
    ).toEqual({ passing: 1, ran: 2 });
  });

  it("counts nothing for versions without runs", () => {
    expect(pipelinesPassingOf([{ runs: [] }, { runs: [] }])).toEqual({ passing: 0, ran: 0 });
  });
});
