import { describe, expect, it } from "vitest";
import { carryForward, changesBetween, isNotified, type Reading } from "../src/notifications/reading";

const reading = (overrides: Partial<Reading> = {}): Reading => ({
  failing: new Map(),
  retrying: new Set(),
  settled: new Map(),
  ...overrides,
});

const settled = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([service, label]) => [service, { id: label, label }]));

describe("changesBetween", () => {
  it("tells nothing at the first reading", () => {
    expect(
      changesBetween(
        undefined,
        reading({ failing: new Map([["api", { message: "boom" }]]), unreadable: "socket hang up" }),
      ),
    ).toEqual([]);
  });

  it("tells services that settled on a newer version, grouped by it", () => {
    const changes = changesBetween(
      reading({ settled: settled({ api: "aaaaaaa", web: "aaaaaaa", worker: "ccccccc" }) }),
      reading({ settled: settled({ api: "bbbbbbb", web: "bbbbbbb", worker: "ccccccc" }) }),
    );

    expect(changes).toEqual([{ kind: "live", label: "bbbbbbb", services: ["api", "web"] }]);
  });

  it("tells a version failing CI once", () => {
    const failed = { id: "b", label: "bbbbbbb", failedWorkflows: ["build"] };
    const first = changesBetween(
      reading({ newest: { id: "a", label: "aaaaaaa", failedWorkflows: [] } }),
      reading({ newest: failed }),
    );
    const again = changesBetween(reading({ newest: failed }), reading({ newest: failed }));

    expect(first).toEqual([{ kind: "ci-failed", label: "bbbbbbb", workflows: ["build"] }]);
    expect(again).toEqual([]);
  });

  it("tells what starts failing, not what already was", () => {
    const changes = changesBetween(
      reading({ failing: new Map([["api", { message: "old" }]]) }),
      reading({
        failing: new Map([
          ["api", { message: "old" }],
          ["Kustomization apps", { message: "health check failed" }],
        ]),
      }),
    );

    expect(changes).toEqual([{ kind: "failing", name: "Kustomization apps", message: "health check failed" }]);
  });

  it("tells once that nothing can be read", () => {
    expect(changesBetween(reading(), reading({ unreadable: "gh is not signed in" }))).toEqual([
      { kind: "unreadable", message: "gh is not signed in" },
    ]);
    expect(changesBetween(reading({ unreadable: "x" }), reading({ unreadable: "x" }))).toEqual([]);
  });
});

describe("carryForward", () => {
  it("tells a service going live after a rollout in between", () => {
    const before = reading({ settled: settled({ api: "aaaaaaa" }) });
    const rollingOut = carryForward(before, reading({ settled: new Map() }));
    const after = reading({ settled: settled({ api: "bbbbbbb" }) });

    expect(changesBetween(rollingOut, after)).toEqual([{ kind: "live", label: "bbbbbbb", services: ["api"] }]);
  });

  it("tells a failure once while it is retried and keeps failing", () => {
    const name = "Kustomization apps";
    const failing = reading({ failing: new Map([[name, { message: "health check failed", version: "a" }]]) });
    const retrying = reading({ retrying: new Set([name]) });
    const told: unknown[] = [];
    let previous = carryForward(undefined, reading());

    for (const next of [failing, retrying, failing, retrying, failing]) {
      told.push(...changesBetween(previous, next));
      previous = carryForward(previous, next);
    }

    expect(told).toEqual([{ kind: "failing", name, message: "health check failed" }]);
  });

  it("tells another version failing while the first one is retried", () => {
    const name = "Kustomization apps";
    const onA = reading({ failing: new Map([[name, { message: "health check failed", version: "a" }]]) });
    const onB = reading({ failing: new Map([[name, { message: "health check failed", version: "b" }]]) });
    const retrying = reading({ retrying: new Set([name]) });
    const told: unknown[] = [];
    let previous = carryForward(undefined, reading());

    for (const next of [onA, retrying, onA, retrying, onB, retrying, onB]) {
      told.push(...changesBetween(previous, next));
      previous = carryForward(previous, next);
    }

    expect(told).toHaveLength(2);
  });

  it("tells a failure again once it recovered in between", () => {
    const name = "Kustomization apps";
    const failing = reading({ failing: new Map([[name, { message: "health check failed", version: "a" }]]) });
    const told: unknown[] = [];
    let previous = carryForward(undefined, reading());

    for (const next of [failing, reading(), failing]) {
      told.push(...changesBetween(previous, next));
      previous = carryForward(previous, next);
    }

    expect(told).toHaveLength(2);
  });

  it("takes nothing as the baseline while the first reading could not be read", () => {
    const unreadableFirst = carryForward(undefined, reading({ unreadable: "socket hang up" }));
    const readable = reading({ failing: new Map([["api", { message: "boom" }]]) });

    expect(unreadableFirst).toBeUndefined();
    expect(changesBetween(unreadableFirst, readable)).toEqual([]);
  });

  it("does not tell again of failures known before the cluster could not be read", () => {
    const failing = reading({ failing: new Map([["api", { message: "boom" }]]) });
    const unreadable = carryForward(failing, reading({ unreadable: "socket hang up" }));
    const recovered = carryForward(unreadable, reading({ failing: new Map([["api", { message: "boom" }]]) }));

    expect(changesBetween(failing, unreadable)).toEqual([{ kind: "unreadable", message: "socket hang up" }]);
    expect(changesBetween(unreadable, recovered)).toEqual([]);
  });
});

describe("isNotified", () => {
  it.each([
    ["all", "live", true],
    ["all", "failing", true],
    ["failures", "live", false],
    ["failures", "ci-failed", true],
    ["off", "failing", false],
    [undefined, "live", true],
  ] as const)("%s, %s → %s", (notify, kind, expected) => {
    expect(isNotified({ kind } as never, notify)).toBe(expected);
  });
});
