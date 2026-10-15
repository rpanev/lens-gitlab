/** Where a service or a GitOps sync sits among the versions watched, 0 being the newest. */
export interface RunningPlace {
  readonly id: string;
  readonly label: string;
  readonly behind: number;
}

const rankWord: Record<string, number> = {
  dev: 0,
  develop: 0,
  development: 0,
  stage: 1,
  staging: 1,
  stg: 1,
  qa: 1,
  uat: 1,
  test: 1,
  prod: 2,
  production: 2,
  prd: 2,
  live: 2,
};

/** dev, then stage, then prod, then a name that names none of them. */
export const environmentRankOf = (name: string) => {
  for (const word of name.toLowerCase().split(/[^a-z0-9]+/)) {
    const rank = rankWord[word];

    if (rank !== undefined) return rank;
  }

  return 3;
};

/** dev → stage → prod, and alphabetically among one rank. */
export const byEnvironment = (name: string, other: string) => {
  const rank = environmentRankOf(name) - environmentRankOf(other);

  return rank !== 0 ? rank : name.localeCompare(other);
};

/**
 * The commit a cluster is on: the oldest of what its services run, or of what its syncs applied when it
 * runs no image of the project. Several versions at once are said so.
 */
export const placeOf = (
  services: readonly { running?: RunningPlace }[],
  syncs: readonly { applied?: RunningPlace }[],
): { readonly place?: RunningPlace; readonly detail: string } => {
  const running = services.flatMap((service) => (service.running ? [service.running] : []));
  const applied = syncs.flatMap((sync) => (sync.applied ? [sync.applied] : []));
  const places = running.length > 0 ? running : applied;
  const noun = running.length > 0 ? "service" : "sync";

  if (places.length === 0) return { detail: "nothing running" };

  const oldest = places.reduce((left, right) => (right.behind > left.behind ? right : left));
  const distinct = new Set(places.map((place) => place.label)).size;
  const named = `${places.length} ${places.length === 1 ? noun : `${noun}s`}`;

  return { place: oldest, detail: distinct === 1 ? named : `${named}, ${distinct} versions` };
};
