/** A Git project a URL names: the host it is on, and its path, such as "group/app". */
export interface GitProject {
  readonly host: string;
  readonly project: string;
}

const stripGit = (path: string) => path.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");

const projectOf = (host: string, path: string): GitProject | undefined => {
  const project = stripGit(path).toLowerCase();

  // At least group/name. A chart repository or a bare host has no such path.
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(project)) return undefined;

  return { host: host.toLowerCase(), project };
};

/**
 * The project a Git remote names, in the forms Flux and Argo CD take: https, ssh or scp-like, with or
 * without ".git". The host is kept, so gitlab.com/group/app is not the same project as a GitLab you host
 * yourself at the same path.
 */
export const gitProjectOfUrl = (url: string): GitProject | undefined => {
  const scp = url.trim().match(/^git@([^:]+):(.+)$/);

  if (scp) return projectOf(scp[1], scp[2]);
  if (!/^(?:ssh|https?):\/\//i.test(url)) return undefined;

  try {
    const parsed = new URL(url);
    const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;

    return projectOf(host, decodeURIComponent(parsed.pathname));
  } catch {
    return undefined;
  }
};
