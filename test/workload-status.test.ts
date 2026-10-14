import { describe, expect, it } from "vitest";
import {
  daemonSetStatusOf,
  deploymentStatusOf,
  podReadinessOf,
  statefulSetStatusOf,
  withSettledAtOfPods,
} from "../src/deployments/workload-status";
import { workload } from "./fixtures";

describe("deploymentStatusOf", () => {
  it("counts ready replicas and takes since when it is stable", () => {
    expect(
      deploymentStatusOf({
        metadata: { generation: 3 },
        spec: { replicas: 2 },
        status: {
          observedGeneration: 3,
          updatedReplicas: 2,
          availableReplicas: 2,
          readyReplicas: 2,
          conditions: [
            { type: "Available", lastUpdateTime: "2026-10-03T08:00:00Z" },
            { type: "Progressing", reason: "NewReplicaSetAvailable", lastUpdateTime: "2026-10-03T09:00:00Z" },
          ],
        },
      }),
    ).toEqual({ rolledOut: true, ready: 2, desired: 2, settledAt: "2026-10-03T09:00:00Z" });
  });

  it("is not stable while a rollout is under way", () => {
    expect(
      deploymentStatusOf({
        metadata: { generation: 4 },
        spec: { replicas: 2 },
        status: {
          observedGeneration: 4,
          updatedReplicas: 1,
          readyReplicas: 1,
          conditions: [{ type: "Progressing", reason: "ReplicaSetUpdated" }],
        },
      }),
    ).toEqual({ rolledOut: false, ready: 1, desired: 2, settledAt: undefined });
  });
});

describe("statefulSetStatusOf and daemonSetStatusOf", () => {
  it("count ready replicas, with no time they are stable since", () => {
    expect(statefulSetStatusOf({ spec: { replicas: 3 }, status: { updatedReplicas: 3, readyReplicas: 3 } })).toEqual({
      rolledOut: true,
      ready: 3,
      desired: 3,
    });
    expect(
      daemonSetStatusOf({
        status: { desiredNumberScheduled: 4, updatedNumberScheduled: 4, numberAvailable: 3, numberReady: 3 },
      }),
    ).toEqual({ rolledOut: false, ready: 3, desired: 4 });
  });
});

describe("withSettledAtOfPods", () => {
  const pod = (owner: string, name: string, readySince?: string) => ({
    metadata: { namespace: "auth", ownerReferences: [{ kind: owner, name }] },
    status: {
      conditions: [
        readySince
          ? { type: "Ready", status: "True", lastTransitionTime: readySince }
          : { type: "Ready", status: "False" },
      ],
    },
  });
  const keycloak = workload("keycloak", "keycloak:26", { kind: "StatefulSet", namespace: "auth" });

  it("takes since when a StatefulSet is stable from the last of its pods to become Ready", () => {
    const pods = [
      pod("StatefulSet", "keycloak", "2026-10-03T08:00:00Z"),
      pod("StatefulSet", "keycloak", "2026-10-04T09:00:00Z"),
      pod("StatefulSet", "other", "2026-10-05T00:00:00Z"),
      pod("ReplicaSet", "api-5d8f", "2026-10-05T00:00:00Z"),
    ].flatMap(podReadinessOf);

    expect(withSettledAtOfPods([keycloak], pods)[0].settledAt).toBe("2026-10-04T09:00:00Z");
  });

  it("says nothing while one of its pods is not Ready, and leaves a Deployment's own time alone", () => {
    const pods = [pod("StatefulSet", "keycloak", "2026-10-03T08:00:00Z"), pod("StatefulSet", "keycloak")].flatMap(
      podReadinessOf,
    );
    const api = workload("api", "api:1", { settledAt: "2026-10-01T00:00:00Z" });

    expect(withSettledAtOfPods([keycloak, api], pods).map((each) => each.settledAt)).toEqual([
      undefined,
      "2026-10-01T00:00:00Z",
    ]);
  });
});
