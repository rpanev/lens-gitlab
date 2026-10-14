import { getKubeResourceKind, getKubernetesApiVersion } from "@k8slens/kubernetes-contracts";

export const kustomizeToolkitV1 = getKubernetesApiVersion("kustomize.toolkit.fluxcd.io/v1");
export const helmToolkitV2 = getKubernetesApiVersion("helm.toolkit.fluxcd.io/v2");
export const helmToolkitV2beta2 = getKubernetesApiVersion("helm.toolkit.fluxcd.io/v2beta2");
export const imageToolkitV1 = getKubernetesApiVersion("image.toolkit.fluxcd.io/v1");
export const imageToolkitV1beta2 = getKubernetesApiVersion("image.toolkit.fluxcd.io/v1beta2");
export const sourceToolkitV1 = getKubernetesApiVersion("source.toolkit.fluxcd.io/v1");
export const sourceToolkitV1beta2 = getKubernetesApiVersion("source.toolkit.fluxcd.io/v1beta2");

export interface Condition {
  readonly type: string;
  readonly status: "True" | "False" | "Unknown";
  readonly reason?: string;
  readonly message?: string;
}

interface Metadata {
  name: string;
  namespace: string;
}

interface ReconciledStatus {
  readonly conditions?: readonly Condition[];
  readonly lastAppliedRevision?: string;
  readonly lastAttemptedRevision?: string;
}

export interface SourceRef {
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string;
}

export const kustomizationKind = getKubeResourceKind<{
  "kustomize.toolkit.fluxcd.io/v1": {
    kind: "Kustomization";
    metadata: Metadata;
    spec: { sourceRef: SourceRef };
    status?: ReconciledStatus;
  };
}>("Kustomization");

interface GitRepositorySpec {
  readonly url: string;
  readonly ref?: {
    readonly branch?: string;
    readonly tag?: string;
    readonly semver?: string;
    readonly commit?: string;
  };
}

/** A Git repository Flux fetches, which Kustomizations and HelmCharts are built from. */
export const gitRepositoryKind = getKubeResourceKind<{
  "source.toolkit.fluxcd.io/v1": {
    kind: "GitRepository";
    metadata: Metadata;
    spec: GitRepositorySpec;
    status?: { artifact?: { revision?: string } };
  };
  "source.toolkit.fluxcd.io/v1beta2": {
    kind: "GitRepository";
    metadata: Metadata;
    spec: GitRepositorySpec;
    status?: { artifact?: { revision?: string } };
  };
}>("GitRepository");

export { gitProjectOfUrl } from "./git-url";

interface HelmReleaseStatus extends ReconciledStatus {
  /** The HelmChart it installs from, as "namespace/name". */
  readonly helmChart?: string;
  /** Flux 2.3 and later: what was released, newest first. */
  readonly history?: readonly { readonly chartVersion?: string; readonly status?: string }[];
}

export const helmReleaseKind = getKubeResourceKind<{
  "helm.toolkit.fluxcd.io/v2": { kind: "HelmRelease"; metadata: Metadata; status?: HelmReleaseStatus };
  "helm.toolkit.fluxcd.io/v2beta2": { kind: "HelmRelease"; metadata: Metadata; status?: HelmReleaseStatus };
}>("HelmRelease");

interface HelmChartStatus {
  /** The chart version built last: what its HelmRelease is to install. */
  readonly artifact?: { readonly revision?: string };
  /** The source revision it was built from, such as "main@sha1:dbfd2c5…" for a chart in a Git repository. */
  readonly observedSourceArtifactRevision?: string;
}

/** The chart a HelmRelease installs, as Flux built it from its source. */
export const helmChartKind = getKubeResourceKind<{
  "source.toolkit.fluxcd.io/v1": { kind: "HelmChart"; metadata: Metadata; status?: HelmChartStatus };
  "source.toolkit.fluxcd.io/v1beta2": { kind: "HelmChart"; metadata: Metadata; status?: HelmChartStatus };
}>("HelmChart");

/** The commit a Git source revision names: "dbfd2c5…" for "main@sha1:dbfd2c5…". */
export const commitOfRevision = (revision?: string) => revision?.match(/sha1:([0-9a-f]{40})/)?.[1];

interface ImagePolicyStatus {
  /** Flux 2.6 and later. */
  readonly latestRef?: { readonly name: string; readonly tag?: string };
  /** Before Flux 2.6. */
  readonly latestImage?: string;
}

/** Flux image automation: the image tag Flux has selected to deploy. */
export const imagePolicyKind = getKubeResourceKind<{
  "image.toolkit.fluxcd.io/v1": { kind: "ImagePolicy"; metadata: Metadata; status?: ImagePolicyStatus };
  "image.toolkit.fluxcd.io/v1beta2": { kind: "ImagePolicy"; metadata: Metadata; status?: ImagePolicyStatus };
}>("ImagePolicy");

export const selectedImageOf = ({ latestRef, latestImage }: ImagePolicyStatus = {}) =>
  latestRef ? `${latestRef.name}:${latestRef.tag ?? ""}` : latestImage;

interface ImageUpdateAutomationStatus {
  readonly lastPushCommit?: string;
  readonly lastPushTime?: string;
}

/** Flux image automation: commits the selected tags to the GitOps repository. */
export const imageUpdateAutomationKind = getKubeResourceKind<{
  "image.toolkit.fluxcd.io/v1": {
    kind: "ImageUpdateAutomation";
    metadata: Metadata;
    status?: ImageUpdateAutomationStatus;
  };
  "image.toolkit.fluxcd.io/v1beta2": {
    kind: "ImageUpdateAutomation";
    metadata: Metadata;
    status?: ImageUpdateAutomationStatus;
  };
}>("ImageUpdateAutomation");
