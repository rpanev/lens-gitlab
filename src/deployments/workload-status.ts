import type { Workload } from "./cluster-images";

/** How a workload stands: whether it rolled out, how many of its replicas are ready, and since when it is stable. */
export interface WorkloadStatus {
  /** Every replica runs the current template. */
  readonly rolledOut: boolean;
  readonly ready: number;
  readonly desired: number;
  /** When it last settled, for a Deployment, the only kind that records it: see Workload's settledAt. */
  readonly settledAt?: string;
}

interface Condition {
  readonly type?: string;
  readonly reason?: string;
  readonly lastUpdateTime?: string;
}

export const deploymentStatusOf = (deployment: {
  metadata: { generation?: number };
  spec: { replicas?: number };
  status?: {
    observedGeneration?: number;
    updatedReplicas?: number;
    availableReplicas?: number;
    readyReplicas?: number;
    conditions?: readonly Condition[];
  };
}): WorkloadStatus => {
  const desired = deployment.spec.replicas ?? 1;
  const status = deployment.status ?? {};
  // Kubernetes stamps "NewReplicaSetAvailable" whenever the Deployment becomes complete again: after a rollout,
  // and also after a scale or a replica that came back, so it tells since when it is stable, not deployed.
  const settled = status.conditions?.find(
    (condition) => condition.type === "Progressing" && condition.reason === "NewReplicaSetAvailable",
  );
  return {
    rolledOut:
      (status.observedGeneration ?? 0) >= (deployment.metadata.generation ?? 0) &&
      (status.updatedReplicas ?? 0) === desired &&
      (status.availableReplicas ?? 0) >= desired,
    ready: status.readyReplicas ?? 0,
    desired,
    settledAt: settled?.lastUpdateTime,
  };
};

export const statefulSetStatusOf = (statefulSet: {
  spec: { replicas?: number };
  status?: { updatedReplicas?: number; readyReplicas?: number };
}): WorkloadStatus => {
  const desired = statefulSet.spec.replicas ?? 1;
  const ready = statefulSet.status?.readyReplicas ?? 0;

  return { rolledOut: (statefulSet.status?.updatedReplicas ?? 0) === desired && ready === desired, ready, desired };
};

export const daemonSetStatusOf = ({
  status,
}: {
  status?: {
    desiredNumberScheduled?: number;
    updatedNumberScheduled?: number;
    numberAvailable?: number;
    numberReady?: number;
  };
}): WorkloadStatus => {
  const desired = status?.desiredNumberScheduled ?? 0;

  return {
    rolledOut: (status?.updatedNumberScheduled ?? 0) === desired && (status?.numberAvailable ?? 0) === desired,
    ready: status?.numberReady ?? 0,
    desired,
  };
};

/** One pod of a StatefulSet or a DaemonSet: which it belongs to, and since when it is Ready, if it is. */
export interface PodReadiness {
  readonly owner: string;
  readonly readySince?: string;
}

export const ownerKeyOf = (kind: string, namespace: string, name: string) => `${kind}/${namespace}/${name}`;

export const podReadinessOf = (pod: {
  metadata: { namespace: string; ownerReferences?: readonly { kind: string; name: string }[] };
  status?: { conditions?: readonly { type: string; status: string; lastTransitionTime?: string }[] };
}): PodReadiness[] => {
  // A Deployment's pods belong to its ReplicaSets, and a Deployment says itself since when it is stable.
  const owner = pod.metadata.ownerReferences?.find((each) => each.kind === "StatefulSet" || each.kind === "DaemonSet");
  const ready = pod.status?.conditions?.find((condition) => condition.type === "Ready" && condition.status === "True");

  return owner
    ? [{ owner: ownerKeyOf(owner.kind, pod.metadata.namespace, owner.name), readySince: ready?.lastTransitionTime }]
    : [];
};

/**
 * Since when a StatefulSet or a DaemonSet is stable, which neither records itself: since the last of its
 * pods became Ready, as a restart or a replacement makes one again. Nothing while one of them is not Ready.
 */
export const settledAtOfPods = (pods: readonly PodReadiness[]) => {
  const byOwner = new Map<string, string | null>();

  for (const { owner, readySince } of pods) {
    const latest = byOwner.get(owner);

    if (latest === null) continue;
    byOwner.set(owner, !readySince ? null : latest && latest > readySince ? latest : readySince);
  }

  return (owner: string) => byOwner.get(owner) ?? undefined;
};

/** The workloads, a StatefulSet or a DaemonSet with its time from its pods, as settledAtOfPods tells it. */
export const withSettledAtOfPods = (workloads: readonly Workload[], pods: readonly PodReadiness[]): Workload[] => {
  const settledAtOf = settledAtOfPods(pods);

  return workloads.map((workload) =>
    workload.kind === "Deployment"
      ? workload
      : { ...workload, settledAt: settledAtOf(ownerKeyOf(workload.kind, workload.namespace, workload.name)) },
  );
};
