import { getPersistableArrayInjectableBunch } from "@k8slens/persistable-contracts";
import type { WatchedRepository } from "./watched-repository";

// One list per cluster.
export const watchedRepositoriesBunch = getPersistableArrayInjectableBunch<WatchedRepository, [clusterId: string]>()({
  id: "watched-repositories",
});
