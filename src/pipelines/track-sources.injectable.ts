import { getInjectable2 } from "@k8slens/injectable";
import { z } from "zod";
import { hostOf, isPrereleaseTag, isReleasesWatch, tagMatches, type WatchedRepository } from "../watched-repositories/watched-repository";
import { urlOnHost } from "./browser-url";
import { type Glab, glabInjectable } from "./glab.injectable";
import { latestMergeRequestOf, type LatestMergeRequest } from "./latest-merge-request";
import { toVersionRuns, type Version, type VersionRuns } from "./version";
import { runsOfCommitWith, toPipeline, type GitlabPipeline, type Pipeline } from "./pipeline";

/** How far back a running service can be placed. */
export const versionsAsked = 30;
/** Releases asked for when only those of a tag pattern count, so enough of them are left. */
const releasesAskedForPattern = 100;
/** The versions whose pipelines are shown. */
export const versionsWithRuns = 5;
const pipelinesAskedPerCommit = 20;
const latestPipelinesAsked = 100;
/**
 * How long a GitLab answer is reused for the same host, project and ref. Shorter than the live check,
 * so that check still asks again; long enough that another cluster watching the same project does not.
 */
const sharedResultFreshMs = 14_000;

const pipelineSchema = z.object({
  id: z.number(),
  sha: z.string(),
  ref: z.string(),
  status: z.string(),
  source: z.string(),
  name: z.string().nullish(),
  web_url: z.string().nullish(),
  finished_at: z.string().nullish(),
});

const commitSchema = z.object({
  id: z.string(),
  title: z.string(),
  committed_date: z.string(),
  author_name: z.string().nullish(),
  web_url: z.string().nullish(),
});

const releaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullish(),
  released_at: z.string().nullish(),
  created_at: z.string().nullish(),
  upcoming_release: z.boolean().nullish(),
  commit: z
    .object({
      id: z.string(),
      title: z.string().nullish(),
    })
    .nullish(),
});

/** Where the versions of one watch come from. */
export interface TrackSource {
  /** The newest version, in one call: what tells a new one has landed. */
  readonly headOf: () => Promise<string | undefined>;
  /** The latest versions, newest first, and the pipelines of the most recent of them. */
  readonly all: () => Promise<{ versions: readonly Version[]; recent: readonly VersionRuns[] }>;
  /** The pipelines of one version again, for a version whose pipelines have not all finished. */
  readonly runsOf: (version: Version) => Promise<VersionRuns>;
  /** The latest merge request into the branch, for a branch. A release watch has none. */
  readonly latestMergeRequest?: () => Promise<LatestMergeRequest | undefined>;
}

const projectIdOf = (project: string) => encodeURIComponent(project);

const apiOf = (project: string, rest = "") => `projects/${projectIdOf(project)}${rest}`;

/** One GraphQL query for a project's latest pipelines. The path is turned into `glab api graphql` by the client. */
const latestPipelinesPath = (project: string) => {
  const params = new URLSearchParams({ fullPath: project, pipelines: String(latestPipelinesAsked) });

  return `graphql?${params.toString()}`;
};

const graphqlNodeSchema = z.object({
  id: z.string(),
  sha: z.string().nullish(),
  ref: z.string().nullish(),
  status: z.string().nullish(),
  source: z.string().nullish(),
  name: z.string().nullish(),
  finishedAt: z.string().nullish(),
});

const graphqlPipelinesSchema = z.object({
  data: z
    .object({
      project: z
        .object({
          pipelines: z.object({
            nodes: z.array(graphqlNodeSchema.nullable()),
          }),
        })
        .nullable(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

/** The latest pipelines GraphQL returned, as the same shape the REST list uses. Newest first. */
const pipelinesFromGraphql = (payload: unknown, host: string, project: string): GitlabPipeline[] => {
  const parsed = graphqlPipelinesSchema.parse(payload);

  if (parsed.errors?.length) throw new Error(parsed.errors.map((error) => error.message).join("; "));

  const found = parsed.data?.project;

  if (!found) throw new Error(`404 Project Not Found: ${project}`);

  return found.pipelines.nodes.flatMap((node) => {
    if (!node?.sha || !node.ref || !node.status) return [];

    const id = Number(node.id.split("/").pop());

    if (!Number.isInteger(id)) return [];

    const source = (node.source ?? "push").toLowerCase();

    return [
      {
        id,
        sha: node.sha,
        ref: node.ref,
        status: node.status.toLowerCase(),
        source,
        name: node.name,
        finished_at: node.finishedAt,
        web_url: `https://${host}/${project}/-/pipelines/${id}`,
      },
    ];
  });
};

/** Where a version's page is, when GitLab did not say. */
const pageUrl = (host: string, project: string, kind: "commit" | "releases", id: string) =>
  `https://${host}/${project}/-/${kind}/${encodeURIComponent(id)}`;

export const trackSourcesInjectable = getInjectable2({
  id: "lens-gitlab-track-sources",

  instantiate: (di) => {
    const glab: Glab = di.inject(glabInjectable)();
    const remembered = new Map<string, { at: number; value: unknown }>();
    const inFlight = new Map<string, Promise<unknown>>();

    /**
     * One answer per host and request, shared by every cluster. A request still running is joined;
     * a recent answer is returned as it is. The key is the API path, which names the project and,
     * for commits, the ref. Nothing here is keyed by cluster.
     */
    const remember = <T>(key: string, load: () => Promise<T>): Promise<T> => {
      const cached = remembered.get(key);

      if (cached && Date.now() - cached.at < sharedResultFreshMs) return Promise.resolve(cached.value as T);

      const pending = inFlight.get(key);

      if (pending) return pending as Promise<T>;

      const finish = () => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      };
      const promise = load().then(
        (value) => {
          remembered.set(key, { at: Date.now(), value });
          finish();

          return value;
        },
        (error: unknown) => {
          finish();

          throw error;
        },
      );

      inFlight.set(key, promise);

      return promise;
    };

    const readJson = (host: string, path: string) =>
      glab.json ? glab.json(host, path) : glab(host, path).then((body) => JSON.parse(body) as unknown);

    /** REST JSON, reused across clusters and not parsed again when GitLab answers 304. */
    const glabJson = (host: string, path: string) => remember(`${host}\n${path}`, () => readJson(host, path));

    const pipelineList = async (host: string, project: string, query: string) =>
      z
        .array(pipelineSchema)
        .parse(await glabJson(host, apiOf(project, `/pipelines?${query}`)))
        .map((pipeline): GitlabPipeline => pipeline);

    // The latest pipelines are the project's, so every ref and every cluster share this one answer.
    const latestRunsOf = (host: string, project: string) =>
      remember(`${host}/${project}/pipelines`, async () =>
        pipelinesFromGraphql(await readJson(host, latestPipelinesPath(project)), host, project)
          .map(toPipeline)
          .sort((a, b) => b.databaseId - a.databaseId),
      );

    /**
     * A commit already among the latest pipelines is matched there. A per-sha request is only for a
     * commit those pipelines do not contain, such as one older than the newest hundred.
     */
    const runsOfCommit = async (host: string, project: string, sha: string, latest: readonly Pipeline[]) => {
      if (latest.some((run) => run.headSha === sha)) return runsOfCommitWith(sha, [], latest);

      const asked = (
        await pipelineList(host, project, `sha=${encodeURIComponent(sha)}&per_page=${pipelinesAskedPerCommit}`)
      ).map(toPipeline);

      return runsOfCommitWith(sha, asked, latest);
    };

    const commitOf = async (host: string, project: string, ref: string) =>
      z
        .object({ id: z.string() })
        .parse(await glabJson(host, apiOf(project, `/repository/commits/${encodeURIComponent(ref)}`))).id;

    const taggedCommitOf = async (host: string, project: string, tag: string) =>
      z
        .object({ id: z.string(), title: z.string() })
        .parse(await glabJson(host, apiOf(project, `/repository/commits/${encodeURIComponent(tag)}`)));

    /**
     * A pipeline's ref is the tag for a release, and a merge request pipeline may run on the same commit
     * under another ref, so only the pipelines of what is followed count.
     */
    const runsOf = async (
      host: string,
      project: string,
      ref: string,
      sha: string,
      version: Version,
      latest: readonly Pipeline[],
    ) =>
      toVersionRuns(
        version,
        (await runsOfCommit(host, project, sha, latest)).filter((run) => run.headBranch === ref),
      );

    const branchSource = (host: string, project: string, branch: string): TrackSource => {
      const latestCommits = async () =>
        z
          .array(commitSchema)
          .parse(
            await glabJson(
              host,
              apiOf(project, `/repository/commits?ref_name=${encodeURIComponent(branch)}&per_page=${versionsAsked}`),
            ),
          )
          .map(
            (commit): Version => ({
              id: commit.id,
              label: commit.id.slice(0, 7),
              title: commit.title,
              at: commit.committed_date,
              author: commit.author_name ?? undefined,
              url: urlOnHost(commit.web_url, host) ?? pageUrl(host, project, "commit", commit.id),
            }),
          );

      return {
        headOf: () => commitOf(host, project, branch),

        latestMergeRequest: async () =>
          latestMergeRequestOf(
            host,
            project,
            z.array(z.unknown()).parse(
              await glabJson(
                host,
                apiOf(
                  project,
                  `/merge_requests?target_branch=${encodeURIComponent(branch)}&order_by=updated_at&sort=desc&per_page=20`,
                ),
              ),
            ),
          ),

        all: async () => {
          const [versions, latest] = await Promise.all([latestCommits(), latestRunsOf(host, project)]);
          const recent = await Promise.all(
            versions.slice(0, versionsWithRuns).map((version) => runsOf(host, project, branch, version.id, version, latest)),
          );

          return { versions, recent };
        },

        runsOf: async (version) => runsOf(host, project, branch, version.id, version, await latestRunsOf(host, project)),
      };
    };

    const releasesSource = (host: string, project: string, includePrereleases: boolean, tagPattern?: string): TrackSource => {
      const latestReleases = async () =>
        z
          .array(releaseSchema)
          .parse(
            await glabJson(
              host,
              apiOf(
                project,
                `/releases?per_page=${tagPattern ? releasesAskedForPattern : versionsAsked}`,
              ),
            ),
          )
          .filter((release) => !release.upcoming_release)
          .filter(
            (release) =>
              (includePrereleases || !isPrereleaseTag(release.tag_name)) && tagMatches(tagPattern, release.tag_name),
          )
          .slice(0, versionsAsked)
          .map(
            (release): Version & { sha?: string; commitTitle?: string } => ({
              id: release.tag_name,
              label: release.tag_name,
              title: release.name?.trim() || release.tag_name,
              at: release.released_at || release.created_at || "",
              prerelease: isPrereleaseTag(release.tag_name),
              url: pageUrl(host, project, "releases", release.tag_name),
              sha: release.commit?.id,
              commitTitle: release.commit?.title ?? undefined,
            }),
          );

      const taggedCommits = new Map<string, Promise<{ id: string; title: string }>>();
      const taggedCommitOfRelease = (tag: string, known?: { id: string; title?: string }) => {
        if (known?.id && known.title) return Promise.resolve({ id: known.id, title: known.title });

        const kept = taggedCommits.get(tag);

        if (kept) return kept;

        const commit = known?.id
          ? Promise.resolve({ id: known.id, title: known.title ?? tag })
          : taggedCommitOf(host, project, tag);

        taggedCommits.set(tag, commit);
        commit.catch(() => taggedCommits.get(tag) === commit && taggedCommits.delete(tag));

        return commit;
      };

      let defaultBranch: Promise<string | undefined> | undefined;
      const defaultBranchOf = () =>
        (defaultBranch ??= glabJson(host, apiOf(project))
          .then((projectInfo) => z.object({ default_branch: z.string() }).parse(projectInfo).default_branch)
          .catch((error: unknown) => {
            defaultBranch = undefined;

            throw error;
          }));

      // A release's own name is usually its tag, so what it says is the message of the commit it points to.
      // Its pipelines are those its tag started; a project that builds the commit on its default branch and
      // tags it afterwards has none, and then the commit's pipelines there are shown.
      const releaseRunsOf = async (
        version: Version & { sha?: string; commitTitle?: string },
        latest: readonly Pipeline[],
      ) => {
        const commit = await taggedCommitOfRelease(
          version.id,
          version.sha ? { id: version.sha, title: version.commitTitle } : undefined,
        );
        const tagged = { ...version, title: commit.title || version.title };
        const runs = await runsOfCommit(host, project, commit.id, latest);
        const own = runs.filter((run) => run.headBranch === version.id);

        if (own.length > 0 || runs.length === 0) return toVersionRuns(tagged, own);

        const branch = await defaultBranchOf();
        const onBranch = runs.filter((run) => run.headBranch === branch);

        return toVersionRuns(tagged, onBranch, onBranch.length > 0 ? branch : undefined);
      };

      return {
        headOf: async () => (await latestReleases())[0]?.id,

        all: async () => {
          const [versions, latest] = await Promise.all([latestReleases(), latestRunsOf(host, project)]);
          const recent = await Promise.all(
            versions.slice(0, versionsWithRuns).map((version) => releaseRunsOf(version, latest)),
          );

          return { versions, recent };
        },

        runsOf: async (version) => releaseRunsOf(version, await latestRunsOf(host, project)),
      };
    };

    return () => (watch: WatchedRepository) => {
      const host = hostOf(watch);

      return isReleasesWatch(watch)
        ? releasesSource(host, watch.repository, !!watch.includePrereleases, watch.tagPattern)
        : branchSource(host, watch.repository, watch.branch);
    };
  },
});
