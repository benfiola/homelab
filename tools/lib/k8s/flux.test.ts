import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { appKustomization, fluxKustomization } from "./flux.ts";

describe("fluxKustomization", () => {
  test("applies a path of the manifests repository", () => {
    const k = fluxKustomization("web", "./apps/web");
    assert.equal(k.kind, "Kustomization");
    assert.deepEqual(k.metadata, { name: "web", namespace: "flux-system" });
    assert.equal(k.spec.path, "./apps/web");
    assert.equal(k.spec.prune, true);
    assert.deepEqual(k.spec.sourceRef, {
      kind: "GitRepository",
      name: "flux-system",
      namespace: "flux-system",
    });
  });

  test("leaves out what isn't asked for", () => {
    const k = fluxKustomization("web", "./apps/web");
    assert.equal(k.spec.force, undefined);
    assert.equal(k.spec.dependsOn, undefined);
  });

  test("can force, and depend on other kustomizations by name", () => {
    const k = fluxKustomization("web", "./apps/web", {
      force: true,
      dependsOn: ["crds", "cert-manager"],
    });
    assert.equal(k.spec.force, true);
    assert.deepEqual(k.spec.dependsOn, [
      { name: "crds" },
      { name: "cert-manager" },
    ]);
  });

  test("an empty dependency list is kept", () => {
    assert.deepEqual(
      fluxKustomization("web", "./apps/web", { dependsOn: [] }).spec.dependsOn,
      [],
    );
  });
});

describe("appKustomization", () => {
  test("by default forces, and depends on nothing", () => {
    const k = appKustomization("web")!;
    assert.equal(k.metadata.name, "web");
    assert.equal(k.spec.path, "./apps/web");
    assert.equal(k.spec.force, true);
    assert.deepEqual(k.spec.dependsOn, []);
  });

  test("an app's declaration changes the default", () => {
    const k = appKustomization("web", { dependsOn: ["crds"], force: false })!;
    assert.equal(k.spec.force, undefined);
    assert.deepEqual(k.spec.dependsOn, [{ name: "crds" }]);
  });

  test("a declaration only changes what it names", () => {
    const k = appKustomization("web", { dependsOn: ["crds"] })!;
    assert.equal(k.spec.force, true);
  });

  test("an app can have no kustomization", () => {
    assert.equal(appKustomization("flux", false), undefined);
  });
});
