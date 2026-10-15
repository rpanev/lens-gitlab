import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rerunFailedJobsInjectable } from "../src/pipelines/rerun-failed-jobs.injectable";
import { durationOf, failedStepOf, isFinished, runJobsSchema } from "../src/pipelines/run-jobs";
import { runJobsInjectable } from "../src/pipelines/run-jobs.injectable";

describe("durationOf", () => {
  it.each([
    [{ startedAt: "2026-10-02T10:00:00Z", completedAt: "2026-10-02T10:00:45Z" }, "45s"],
    [{ startedAt: "2026-10-02T10:00:00Z", completedAt: "2026-10-02T10:02:10Z" }, "2m 10s"],
    [{ startedAt: "2026-10-02T10:00:00Z", completedAt: "2026-10-02T11:03:00Z" }, "1h 3m"],
    [{ startedAt: "2026-10-02T10:00:00Z", completedAt: null }, "5m 0s"], // still running
    [{ startedAt: null, completedAt: null }, undefined], // queued
  ])("%o → %s", (job, expected) => {
    expect(durationOf(job, Date.parse("2026-10-02T10:05:00Z"))).toBe(expected);
  });
});

describe("failedStepOf", () => {
  it("names the step a job failed in", () => {
    expect(
      failedStepOf({
        steps: [
          { name: "Checkout", status: "completed", conclusion: "success" },
          { name: "Run tests", status: "completed", conclusion: "failure" },
        ],
      }),
    ).toBe("Run tests");
    expect(failedStepOf({ steps: [] })).toBeUndefined();
    expect(failedStepOf({ steps: null })).toBeUndefined();
  });
});

describe("runJobsSchema", () => {
  it("reads a pipeline's jobs", () => {
    const { jobs } = runJobsSchema.parse(
      JSON.parse(readFileSync(new URL("./pipeline-jobs.json", import.meta.url), "utf8")),
    );

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.url.startsWith("https://gitlab.com/"))).toBe(true);
  });
});

describe("runJobsInjectable", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const job = (status: string) => ({
    id: 1,
    name: "build",
    stage: "test",
    status,
    web_url: "https://gitlab.com/o/app/-/jobs/1",
  });

  it("asks again while jobs run, and stops once they finished", async () => {
    let status = "running";
    const paths: string[] = [];
    const glab = async (_host: string, path: string) => {
      paths.push(path);

      return path.includes("/bridges") ? "[]" : JSON.stringify([job(status)]);
    };
    const jobs = (runJobsInjectable as any).instantiate({ inject: () => () => glab })("gitlab.com", "o/app", 42);

    jobs.watch("in_progress/");
    await vi.advanceTimersByTimeAsync(0);
    expect(jobs.state.jobs.every(isFinished)).toBe(false);

    status = "success";
    await vi.advanceTimersByTimeAsync(15_000);
    const asked = paths.length;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(jobs.state.jobs.every(isFinished)).toBe(true);
    expect(paths.length).toBe(asked);
    expect(paths[0]).toBe("projects/o%2Fapp/pipelines/42/jobs?per_page=100");
  });
});

describe("runJobsInjectable, after a re-run", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks again once, when the run's status changes", async () => {
    let calls = 0;
    const glab = async (_host: string, path: string) => (calls++, path.includes("/bridges") ? "[]" : "[]");
    const jobs = (runJobsInjectable as any).instantiate({ inject: () => () => glab })("gitlab.com", "o/app", 42);

    const stop = jobs.watch("completed/failure");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2); // jobs and bridges, then finished: nothing to wait for

    stop();
    jobs.watch("queued/");
    void jobs.refresh(); // the re-run's own refresh joins the reload
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toBe(4);
  });
});

describe("rerunFailedJobsInjectable", () => {
  const rerunWith = (confirmed: boolean, glab: (host: string, path: string, method?: string) => Promise<string>) => {
    const notifications: string[] = [];
    const inject = (token: any) => {
      if (token?.id === "lens-gitlab-glab") return () => glab;
      if (String(token?.id ?? "").includes("notification"))
        return () => (message: string) => notifications.push(message);
      return () => async () => confirmed;
    };
    const rerun = (rerunFailedJobsInjectable as any).instantiate({ inject, scopeIds: [] })();

    return { rerun, notifications };
  };

  it("re-runs nothing unless confirmed", async () => {
    const glab = vi.fn(async () => "");
    const { rerun } = rerunWith(false, glab);

    expect(await rerun("gitlab.com", "o/app", 42, "build", "aaaaaaa")).toBe(false);
    expect(glab).not.toHaveBeenCalled();
  });

  it("re-runs the failed jobs once confirmed", async () => {
    const glab = vi.fn(async () => "");
    const { rerun } = rerunWith(true, glab);

    expect(await rerun("gitlab.com", "o/app", 42, "build", "aaaaaaa")).toBe(true);
    expect(glab).toHaveBeenCalledWith("gitlab.com", "projects/o%2Fapp/pipelines/42/retry", "POST");
  });

  it("says why it could not", async () => {
    const { rerun, notifications } = rerunWith(true, async () => {
      throw new Error("glab: 403 Forbidden");
    });

    expect(await rerun("gitlab.com", "o/app", 42, "build", "aaaaaaa")).toBe(false);
    expect(notifications[0]).toContain("Could not re-run build");
  });
});
