import { describe, expect, it } from "vitest";
import { imageIsOfCommit, imageIsOfRelease, imageNameOf } from "../src/deployments/cluster-images";

const sha = "76cd335b82ae2e8be6bad70826a64a8365d215a9";
const registry = "841601950514.dkr.ecr.eu-west-1.amazonaws.com";

describe("imageIsOfCommit", () => {
  it.each([
    [`${registry}/lens-cloud-backend:76cd335`, true],
    [`${registry}/lens-cloud-backend:main-76cd335-1727771237`, true],
    [`registry:5000/app:sha-${sha}`, true],
    ["app:76cd335b@sha256:abc", true],
    ["app:76CD335", true],
    ["app:9db7dda", false],
    ["app:76cd33", false], // shorter than 7 is no commit id
    ["registry:5000/76cd335/app", false], // in the path, not the tag
    ["app:1.2.3", false],
    ["app", false],
  ])("%s → %s", (image, expected) => {
    expect(imageIsOfCommit(image, sha)).toBe(expected);
  });
});

describe("imageIsOfRelease", () => {
  it.each([
    ["backend:v2026.9.3-rc.1", "v2026.9.3-rc.1", true],
    ["backend:2026.9.3-rc.1", "v2026.9.3-rc.1", true], // with or without the leading v
    ["backend:v2026.9.3", "2026.9.3", true],
    ["backend:v2026.9.3", "v2026.9.3-rc.1", false],
    ["backend:v2026.9.3-rc.1", "v2026.9.3", false],
    ["backend:v1.2.3@sha256:abc", "v1.2.3", true],
    ["backend", "v1.2.3", false],
    ["backend:version", "version", true], // only a v before a digit is dropped
  ])("%s for %s → %s", (image, tag, expected) => {
    expect(imageIsOfRelease(image, tag)).toBe(expected);
  });
});

describe("imageNameOf", () => {
  it.each([
    [`${registry}/lens-cloud-backend:main-76cd335`, "lens-cloud-backend"],
    ["registry:5000/team/app:1.0", "app"],
    ["app@sha256:abc", "app"],
    ["quay.io/k8slens/bored:0.10.4", "bored"],
    ["nginx", "nginx"],
  ])("%s → %s", (image, expected) => {
    expect(imageNameOf(image)).toBe(expected);
  });
});
