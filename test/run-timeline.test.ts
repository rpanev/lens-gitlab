import { describe, expect, it } from "vitest";
import { barOf, formatSpan, spanOf, stepSegmentsOf } from "../src/workflow-runs/run-timeline";

const t = (seconds: number) => new Date(Date.parse("2026-10-02T10:00:00Z") + seconds * 1000).toISOString();

describe("spanOf", () => {
  it("runs from the first start to the last end", () => {
    expect(
      spanOf([
        { startedAt: t(10), completedAt: t(40) },
        { startedAt: t(0), completedAt: t(20) },
      ]),
    ).toEqual({
      start: Date.parse(t(0)),
      end: Date.parse(t(40)),
    });
  });

  it("counts what still runs up to now, and is nothing before anything started", () => {
    expect(spanOf([{ startedAt: t(0), completedAt: null }], Date.parse(t(90)))?.end).toBe(Date.parse(t(90)));
    expect(spanOf([{ startedAt: null, completedAt: null }])).toBeUndefined();
  });
});

describe("barOf", () => {
  const span = { start: Date.parse(t(0)), end: Date.parse(t(100)) };

  it("places an item within the span", () => {
    expect(barOf({ startedAt: t(25), completedAt: t(75) }, span)).toEqual({ offset: 25, width: 50 });
  });

  it("keeps a sliver for what took no time, and nothing for what has not started", () => {
    expect(barOf({ startedAt: t(50), completedAt: t(50) }, span)?.width).toBe(0.5);
    expect(barOf({ startedAt: null }, span)).toBeUndefined();
  });
});

describe("stepSegmentsOf", () => {
  it("gives each step its share of the job", () => {
    const segments = stepSegmentsOf({
      steps: [
        { name: "Checkout", status: "completed", conclusion: "success", startedAt: t(0), completedAt: t(25) },
        { name: "Test", status: "completed", conclusion: "failure", startedAt: t(25), completedAt: t(100) },
        { name: "Upload", status: "completed", conclusion: "skipped", startedAt: null, completedAt: null },
      ],
    });

    expect(segments.map((each) => [each.step.name, each.share, each.status.label])).toEqual([
      ["Checkout", 25, "Success"],
      ["Test", 75, "Failed"],
    ]);
  });
});

describe("formatSpan", () => {
  it.each([
    [45_000, "45s"],
    [384_000, "6m 24s"],
    [3_780_000, "1h 3m"],
  ])("%d → %s", (milliseconds, expected) => {
    expect(formatSpan(milliseconds)).toBe(expected);
  });
});
