import { A, Button, Div, Span } from "@k8slens/element-components";
import { ChevronRightIcon, ExpandMoreIcon } from "@k8slens/icon";
import { PlainButton } from "@k8slens/input-components";
import { useInject } from "@k8slens/use-inject";
import { observer } from "mobx-react";
import { useEffect } from "react";
import { openVersionInjectable } from "../pipelines/open-version.injectable";
import { playManualJobInjectable } from "../pipelines/play-job.injectable";
import { rerunFailedJobsInjectable } from "../pipelines/rerun-failed-jobs.injectable";
import { durationOf, failedStepOf, isFailed, type RunJob } from "../pipelines/run-jobs";
import { runJobsInjectable } from "../pipelines/run-jobs.injectable";
import { opensByDefault, runStatusOf } from "../pipelines/run-status";
import { barOf, formatSpan, spanOf, stepSegmentsOf, type TimeSpan } from "../pipelines/run-timeline";
import { summaryOf, type VersionRuns } from "../pipelines/version";
import { runUrlOf, type Pipeline } from "../pipelines/pipeline";
import { expandedInjectable } from "./expanded.injectable";
import { FailedLog } from "./failed-log";
import { RunStatusIcon } from "./run-status-icon";

const Toggle = ({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) => (
  <Button $onClick={onToggle} $tooltip={open ? `Hide ${label}` : `Show ${label}`} $interactive>
    {open ? <ExpandMoreIcon $size="s" /> : <ChevronRightIcon $size="s" />}
  </Button>
);

/** Where a job ran within its pipeline, as a bar on a track: parallel and slow jobs stand out. */
const TimelineBar = ({ job, span }: { job: RunJob; span?: TimeSpan }) => {
  const bar = span && barOf(job, span);

  return (
    <Div
      $flexChild
      $backgroundColor="backgroundPrimary"
      $border={{ radius: "m" }}
      $relative
      $style={{ height: 8, minWidth: 120 }}
    >
      {bar && (
        <Div
          $backgroundColor={runStatusOf(job).color}
          $border={{ radius: "m" }}
          $style={{ position: "absolute", top: 0, bottom: 0, left: `${bar.offset}%`, width: `${bar.width}%` }}
        />
      )}
    </Div>
  );
};

/** A job's steps as segments of one bar, each its share of the job's time, then as a list. */
const Steps = ({ job }: { job: RunJob }) => {
  const segments = stepSegmentsOf(job);

  return (
    <Div $flex={{ direction: "vertical", gap: "s" }} $padding={{ left: "3xl" }}>
      {segments.length > 0 && (
        <Div $flex={{ direction: "horizontal" }} $style={{ height: 6, gap: 2 }}>
          {segments.map(({ step, share, status }) => (
            <Div
              key={`${step.number}-${step.name}`}
              $backgroundColor={status.color}
              $tooltip={`${step.name} · ${durationOf(step) ?? ""} · ${status.label}`}
              $width={`${share}%`}
              $style={{ borderRadius: 2 }}
            />
          ))}
        </Div>
      )}
      <Div $style={{ display: "grid", gridTemplateColumns: "16px 1fr auto", columnGap: 8, rowGap: 4 }}>
        {(job.steps ?? []).map((step) => (
          <Div key={`${step.number}-${step.name}`} $displayContents>
            <RunStatusIcon status={runStatusOf(step)} />
            <Span $color={isFailed(step) ? "critical" : undefined}>{step.name}</Span>
            <Span $color="textMuted">{durationOf(step) ?? ""}</Span>
          </Div>
        ))}
      </Div>
    </Div>
  );
};

const JobLine = observer(
  ({
    host,
    project,
    job,
    version,
    span,
    place,
    compact,
    onPlayed,
  }: {
    host: string;
    project: string;
    job: RunJob;
    version: string;
    span?: TimeSpan;
    place: string;
    compact: boolean;
    onPlayed: () => void;
  }) => {
    const expanded = useInject(expandedInjectable)(place);
    const openLink = useInject(openVersionInjectable)();
    const playManualJob = useInject(playManualJobInjectable)();
    const id = `job:${job.databaseId}`;
    const open = !compact && expanded.isOpen(id, isFailed(job));
    const failedStep = failedStepOf(job);

    return (
      <Div $flex={{ direction: "vertical", gap: "s" }}>
        <Div $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}>
          {!compact && <Toggle open={open} onToggle={() => expanded.toggle(id, isFailed(job))} label="the steps" />}
          <RunStatusIcon status={runStatusOf(job)} />
          <A
            onClick={() => void openLink({ url: job.url })}
            $tooltip="Open the job's log on GitLab"
            $color="link"
            $style={{
              minWidth: 160,
              maxWidth: 320,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {job.name}
          </A>
          <TimelineBar job={job} span={span} />
          <Span $color="textMuted" $textAlign="right" $style={{ minWidth: 64 }}>
            {job.status === "manual" ? "manual" : (durationOf(job) ?? "queued")}
          </Span>
          {job.status === "manual" && (
            <PlainButton
              onClick={() =>
                void playManualJob(host, project, job.databaseId, job.name, version).then((played) => {
                  if (played) onPlayed();
                })
              }
            >
              Play
            </PlainButton>
          )}
        </Div>
        {failedStep && !open && (
          <Span $color="critical" $padding={{ left: "3xl" }}>
            failed in {failedStep}
          </Span>
        )}
        {open && <Steps job={job} />}
        {open && isFailed(job) && (
          <Div $padding={{ left: "3xl" }}>
            <FailedLog host={host} project={project} job={job} />
          </Div>
        )}
      </Div>
    );
  },
);

const RunCard = observer(
  ({
    host,
    project,
    run,
    version,
    onRerun,
    place,
    compact,
  }: {
    host: string;
    project: string;
    run: Pipeline;
    version: string;
    onRerun: () => void;
    place: string;
    compact: boolean;
  }) => {
    const jobs = useInject(runJobsInjectable)(host, project, run.databaseId);
    const expanded = useInject(expandedInjectable)(place);
    const openLink = useInject(openVersionInjectable)();
    const rerunFailedJobs = useInject(rerunFailedJobsInjectable)();
    const status = runStatusOf(run);
    const id = `run:${run.databaseId}`;
    // What succeeded starts folded: the eye goes to what failed or still runs.
    const byDefault = opensByDefault(run);
    const open = expanded.isOpen(id, byDefault);
    const { state } = jobs;
    const span = state.status === "loaded" ? spanOf(state.jobs) : undefined;

    // The jobs are asked for again when the run's status changes, as when it was re-run.
    useEffect(() => jobs.watch(`${run.status}/${run.conclusion}`), [jobs, run.status, run.conclusion]);

    const rerun = async () => {
      if (await rerunFailedJobs(host, project, run.databaseId, run.name, version)) {
        onRerun();
        void jobs.refresh();
      }
    };

    return (
      <Div
        $flex={{ direction: "vertical", gap: compact ? "s" : "m" }}
        $padding={compact ? "m" : "l"}
        $backgroundColor="backgroundSecondary"
        $border={{ color: "borderPrimary", width: "xxs", radius: "m", left: { width: "xs", color: status.color } }}
      >
        <Div $flex={{ direction: "horizontal", gap: "s", verticalAlign: "center" }}>
          <Toggle open={open} onToggle={() => expanded.toggle(id, byDefault)} label="the jobs" />
          <RunStatusIcon status={status} />
          <A
            onClick={() => void openLink({ url: runUrlOf(host, project, run) })}
            $tooltip="Open the pipeline on GitLab"
            $color="link"
            $font={compact ? undefined : { size: "l" }}
          >
            {run.name}
          </A>
          <Span $color="textMuted">{status.label}</Span>
          {span && <Span $color="textMuted">· {formatSpan(span.end - span.start)}</Span>}
          {state.status === "loaded" && (
            <Span $color="textMuted">
              · {state.jobs.length} {state.jobs.length === 1 ? "job" : "jobs"}
            </Span>
          )}
          <Div $flexChild />
          {status.color === "critical" && <PlainButton onClick={() => void rerun()}>Re-run failed jobs</PlainButton>}
        </Div>
        {open && state.status === "loading" && <Span $color="textMuted">Loading jobs…</Span>}
        {open && state.status === "failed" && (
          <Span $color="warning" $tooltip={state.problem.detail}>
            Could not read the jobs: {state.problem.title}
          </Span>
        )}
        {open &&
          state.status === "loaded" &&
          state.jobs.map((job) => (
            <JobLine
              key={job.url}
              host={host}
              project={project}
              job={job}
              version={version}
              span={span}
              place={place}
              compact={compact}
              onPlayed={() => {
                onRerun();
                void jobs.refresh();
              }}
            />
          ))}
      </Div>
    );
  },
);

const Summary = ({ row }: { row: VersionRuns }) => {
  const { text, status } = summaryOf(row);

  return (
    <Div $flex={{ direction: "horizontal", gap: "m", verticalAlign: "center" }}>
      {status && <RunStatusIcon status={status} />}
      <Span $font={{ size: "l" }}>{text}</Span>
      {status && <Span $color="textMuted">· {status.label}</Span>}
      {row.runsOn && <Span $color="textMuted">· runs of the tagged commit on {row.runsOn}</Span>}
    </Div>
  );
};

/**
 * A version's pipelines: a card per pipeline, folded when it succeeded, with a timeline of its jobs. In
 * full, as the pipelines tab shows them, each job opens to its trace when it failed;
 * compact, as the details panel gives a quick look under the version's own properties, a job is its line
 * alone and the version's message is left to those properties.
 */
export const PipelineCards = ({
  host,
  project,
  row,
  onRerun,
  place,
  compact = false,
}: {
  host: string;
  project: string;
  row: VersionRuns;
  onRerun: () => void;
  /** What the open and closed cards are remembered by. */
  place: string;
  compact?: boolean;
}) => (
  <Div $flex={{ direction: "vertical", gap: compact ? "m" : "l" }}>
    {!compact && <Span $color="textMuted">{row.version.title}</Span>}
    <Summary row={row} />
    {row.runs.map((run) => (
      <RunCard
        key={run.databaseId}
        host={host}
        project={project}
        run={run}
        version={row.version.label}
        onRerun={onRerun}
        place={place}
        compact={compact}
      />
    ))}
    {/* Recorded against the commit, such as a merge request pipeline, without the commit starting it. */}
    {row.otherRuns.length > 0 && (
      <Div $flex={{ direction: "vertical", gap: "m" }} $faded>
        <Span $color="textMuted">Also ran on this commit · not started by it</Span>
        {row.otherRuns.map((run) => (
          <RunCard
            key={run.databaseId}
            host={host}
            project={project}
            run={run}
            version={row.version.label}
            onRerun={onRerun}
            place={place}
            compact={compact}
          />
        ))}
      </Div>
    )}
  </Div>
);
