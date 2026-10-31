import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";
import { listApps } from "./lib/apps.ts";
import { renderApp } from "./lib/render.ts";

// the real flux app
describe("apps/flux", async () => {
  const appsDir = join(import.meta.dirname, "../apps");
  const objects = await renderApp(join(appsDir, "flux"));
  const kustomizations = objects.filter((o) => o.kind === "Kustomization");

  test("deploys every app, and the generated crds, from its own directory", () => {
    const want = [
      ...listApps(appsDir).filter((a) => a !== "flux"),
      "crds",
    ].sort();
    assert.deepEqual(kustomizations.map((k) => k.metadata.name).sort(), want);
    for (const k of kustomizations) {
      assert.equal(k.spec.path, `./apps/${k.metadata.name}`);
    }
  });

  test("does not deploy itself, which flux-bootstrap hands to flux instead", () => {
    assert.ok(!kustomizations.some((k) => k.metadata.name === "flux"));
    assert.ok(
      !kustomizations.some((k) => k.metadata.name === "flux-bootstrap"),
    );
  });

  test("sizes each of flux's controllers with an autoscaler", () => {
    const vpas = objects
      .filter((o) => o.kind === "VerticalPodAutoscaler")
      .map((o) => o.spec.targetRef.name);
    assert.deepEqual(vpas.sort(), [
      "helm-controller",
      "kustomize-controller",
      "notification-controller",
      "source-controller",
    ]);
  });
});
