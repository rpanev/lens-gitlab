import { gitProjectOfUrl } from "../deployments/git-url";
import {
  checkIntervalsInMinutes,
  followedLabelOf,
  hostOf,
  isSameWatch,
  type WatchedRepository,
} from "./watched-repository";

export const defaultHost = "gitlab.com";
export const defaultBranch = "main";
export const defaultIntervalMinutes = 5;

const projectPattern = /^[\w.-]+(?:\/[\w.-]+)+$/;
const hostPattern = /^(?:localhost|[\w.-]+)(?::\d{1,5})?$/;

/** A typed project path, or a pasted remote, as the host and path a watch stores. */
export const projectInputOf = (raw: string, host: string): { host: string; project: string } => {
  const trimmed = raw.trim();
  const parsed = /^(?:https?:\/\/|ssh:\/\/|git@)/i.test(trimmed) ? gitProjectOfUrl(trimmed) : undefined;

  if (parsed) return parsed;

  return { host: (host.trim() || defaultHost).toLowerCase(), project: trimmed };
};

export interface WatchFields {
  readonly host: string;
  readonly repository: string;
  readonly track: "branch" | "releases";
  readonly branch: string;
  readonly includePrereleases: boolean;
  readonly tagPattern: string;
  readonly intervalMinutes: number;
  readonly notify: "all" | "failures" | "off";
}

/** The watch the settings form would save from its fields. */
export const watchOfFields = (fields: WatchFields): WatchedRepository => {
  const parsed = projectInputOf(fields.repository, fields.host);
  const host = parsed.host === defaultHost ? undefined : parsed.host;

  return fields.track === "releases"
    ? {
        host,
        repository: parsed.project,
        track: "releases",
        branch: "",
        includePrereleases: fields.includePrereleases,
        tagPattern: fields.tagPattern.trim() || undefined,
        intervalMinutes: fields.intervalMinutes,
        notify: fields.notify,
      }
    : {
        host,
        repository: parsed.project,
        track: "branch",
        branch: fields.branch.trim(),
        intervalMinutes: fields.intervalMinutes,
        notify: fields.notify,
      };
};

/** What is wrong with a watch that has a project, or nothing when it can be saved. */
export const watchProblemOf = (watch: WatchedRepository): string | undefined => {
  if (!hostPattern.test(hostOf(watch))) return "Write the host as a name, such as gitlab.com.";
  if (!projectPattern.test(watch.repository)) return 'Write the project as "group/project".';
  if ((watch.track ?? "branch") === "branch" && watch.branch.trim() === "") return "Name a branch.";
  if (watch.tagPattern && /\s/.test(watch.tagPattern))
    return "A tag pattern has no spaces, such as v* or artifact-contract/v*.";
  if (!(checkIntervalsInMinutes as readonly number[]).includes(watch.intervalMinutes))
    return `Check every ${checkIntervalsInMinutes.join(", ")} minutes.`;
  if (watch.notify !== undefined && watch.notify !== "all" && watch.notify !== "failures" && watch.notify !== "off")
    return 'Notify is "all", "failures" or "off".';

  return undefined;
};

export interface SaveWatchRequest {
  readonly project: string;
  readonly host?: string;
  readonly track?: "branch" | "releases";
  readonly branch?: string;
  readonly includePrereleases?: boolean;
  readonly tagPattern?: string;
  readonly intervalMinutes?: number;
  readonly notify?: "all" | "failures" | "off";
  /** Stop watching the project instead of saving it. */
  readonly stop?: boolean;
}

export type SaveWatchPlan =
  | { readonly action: "add"; readonly watch: WatchedRepository }
  | { readonly action: "replace"; readonly previous: WatchedRepository; readonly watch: WatchedRepository }
  | { readonly action: "remove"; readonly watch: WatchedRepository }
  | { readonly action: "error"; readonly message: string };

const sameProject = (watch: WatchedRepository, host: string, project: string) =>
  hostOf(watch) === host && watch.repository.toLowerCase() === project.toLowerCase();

/** Whether a watch is the one a stop request names. Unnamed fields do not have to match. */
const matchesStop = (watch: WatchedRepository, request: SaveWatchRequest) => {
  if (request.track === "branch" && (watch.track ?? "branch") !== "branch") return false;
  if (request.track === "releases" && watch.track !== "releases") return false;

  if (request.branch !== undefined && request.track !== "releases") {
    if ((watch.track ?? "branch") !== "branch") return false;
    if (watch.branch.toLowerCase() !== request.branch.trim().toLowerCase()) return false;
  }

  if (request.tagPattern !== undefined && (watch.tagPattern ?? "") !== request.tagPattern.trim()) return false;
  if (
    request.includePrereleases !== undefined &&
    watch.track === "releases" &&
    (watch.includePrereleases ?? true) !== request.includePrereleases
  )
    return false;

  return true;
};

const specifiesFollow = (request: SaveWatchRequest) =>
  request.track !== undefined ||
  request.branch !== undefined ||
  request.includePrereleases !== undefined ||
  request.tagPattern !== undefined;

/** The watch a request would save, keeping what a project already watched left unsaid. */
const watchOfRequest = (
  request: SaveWatchRequest,
  parsed: { host: string; project: string },
  previous: WatchedRepository | undefined,
): WatchedRepository | string => {
  if (request.track !== undefined && request.track !== "branch" && request.track !== "releases")
    return 'Follow is "branch" or "releases".';

  // A branch or a release field, with no track, is which of the two is meant.
  const track =
    request.track ??
    (request.branch !== undefined
      ? "branch"
      : request.includePrereleases !== undefined || request.tagPattern !== undefined
        ? "releases"
        : (previous?.track ?? "branch"));
  const branch =
    request.branch !== undefined
      ? request.branch.trim()
      : track === "branch"
        ? (previous && (previous.track ?? "branch") === "branch" ? previous.branch : "") || defaultBranch
        : "";
  const includePrereleases =
    request.includePrereleases ?? (previous?.track === "releases" ? (previous.includePrereleases ?? true) : true);
  const tagPattern =
    request.tagPattern !== undefined
      ? request.tagPattern.trim() || undefined
      : track === "releases" && previous?.track === "releases"
        ? previous.tagPattern
        : undefined;
  const intervalMinutes = request.intervalMinutes ?? previous?.intervalMinutes ?? defaultIntervalMinutes;
  const notify = request.notify ?? previous?.notify ?? "all";
  const host = parsed.host === defaultHost ? undefined : parsed.host;
  const watch: WatchedRepository =
    track === "releases"
      ? {
          host,
          repository: parsed.project,
          track,
          branch: "",
          includePrereleases,
          tagPattern,
          intervalMinutes,
          notify,
        }
      : { host, repository: parsed.project, track: "branch", branch, intervalMinutes, notify };

  return watchProblemOf(watch) ?? watch;
};

/**
 * What saving a project from Ask AI does to the list already watched: add it, replace the one it
 * changes, remove it, or refuse, with the reason.
 */
export const planSaveWatch = (existing: readonly WatchedRepository[], request: SaveWatchRequest): SaveWatchPlan => {
  if (request.project.trim() === "") return { action: "error", message: 'Name the project as "group/project".' };

  const parsed = projectInputOf(request.project, request.host ?? defaultHost);

  if (!hostPattern.test(parsed.host))
    return { action: "error", message: "Write the host as a name, such as gitlab.com." };
  if (!projectPattern.test(parsed.project))
    return { action: "error", message: 'Write the project as "group/project".' };

  const ofProject = existing.filter((watch) => sameProject(watch, parsed.host, parsed.project));

  if (ofProject.length > 1 && !specifiesFollow(request))
    return {
      action: "error",
      message: `${parsed.project} is watched as ${ofProject.map(followedLabelOf).join(", ")}. Say which one${request.stop ? " to stop" : ""}.`,
    };

  if (request.stop) {
    // "releases" means the releases watch, tag pattern aside: naming one that is not there leaves the other.
    const candidates = ofProject.filter((watch) => matchesStop(watch, request));

    if (candidates.length === 1) return { action: "remove", watch: candidates[0] };
    if (candidates.length > 1)
      return {
        action: "error",
        message: `${parsed.project} is watched as ${candidates.map(followedLabelOf).join(", ")}. Say which one to stop.`,
      };

    return { action: "error", message: `${parsed.project} on ${parsed.host} is not watched.` };
  }

  const only = ofProject.length === 1 ? ofProject[0] : undefined;
  const probe = watchOfRequest(request, parsed, only);

  if (typeof probe === "string") return { action: "error", message: probe };

  const exact = ofProject.find((watch) => isSameWatch(watch, probe));
  // The one watch of a project is what a request changes, even when it names another follow.
  const previous = exact ?? only;
  const drafted = previous ? watchOfRequest(request, parsed, previous) : probe;

  if (typeof drafted === "string") return { action: "error", message: drafted };

  if (ofProject.length > 1 && !exact) return { action: "add", watch: drafted };

  const clash = existing.find(
    (watch) => isSameWatch(watch, drafted) && (!previous || !isSameWatch(watch, previous)),
  );

  if (clash)
    return { action: "error", message: `${drafted.repository} ${followedLabelOf(drafted)} is already watched.` };

  return previous ? { action: "replace", previous, watch: drafted } : { action: "add", watch: drafted };
};
