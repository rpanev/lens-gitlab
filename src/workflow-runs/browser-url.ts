/**
 * An http(s) page with no user or password in it. http is only for this machine: Lens opens
 * http and https, and a page GitLab did not serve must not be handed to the browser as a link.
 */
export const browserUrlOf = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);

    if (parsed.username || parsed.password) return undefined;

    const local =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";

    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && local)) return parsed.href;

    return undefined;
  } catch {
    return undefined;
  }
};

/** A page on the GitLab host a watch reads. A link to anywhere else is dropped. */
export const urlOnHost = (url: string | null | undefined, host: string): string | undefined => {
  const safe = url ? browserUrlOf(url) : undefined;

  if (!safe) return undefined;

  const parsed = new URL(safe);
  const actual = (parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname).toLowerCase();

  return actual === host.toLowerCase() ? safe : undefined;
};
