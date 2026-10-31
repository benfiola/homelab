import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { moveToNamespace } from "./namespace.ts";

const move = (...objects: Record<string, any>[]) =>
  moveToNamespace(objects, "new");

describe("moveToNamespace", () => {
  test("puts every object in the namespace, and renames a Namespace", () => {
    const [config, namespace] = move(
      { kind: "ConfigMap", metadata: { name: "c", namespace: "old" } },
      { kind: "Namespace", metadata: { name: "old" } },
    );
    assert.equal(config.metadata.namespace, "new");
    assert.equal(namespace.metadata.name, "new");
  });

  test("a binding's subjects follow the service accounts that moved, and the default one", () => {
    const [, binding] = move(
      { kind: "ServiceAccount", metadata: { name: "sa" } },
      {
        kind: "RoleBinding",
        metadata: { name: "b" },
        subjects: [
          { kind: "ServiceAccount", name: "sa", namespace: "old" },
          { kind: "ServiceAccount", name: "default", namespace: "old" },
          { kind: "ServiceAccount", name: "elsewhere", namespace: "old" },
          { kind: "User", name: "sa", namespace: "old" },
        ],
      },
    );
    assert.deepEqual(
      binding.subjects.map((s: any) => s.namespace),
      ["new", "new", "old", "old"],
    );
  });

  test("a webhook's service follows", () => {
    const [hook] = move({
      kind: "ValidatingWebhookConfiguration",
      metadata: { name: "h" },
      webhooks: [
        { clientConfig: { service: { name: "s", namespace: "old" } } },
        { clientConfig: { url: "https://example.test" } },
      ],
    });
    assert.equal(hook.webhooks[0].clientConfig.service.namespace, "new");
    assert.equal("service" in hook.webhooks[1].clientConfig, false);
  });

  test("so does the service a crd's conversion webhook calls", () => {
    const [crd] = move({
      kind: "CustomResourceDefinition",
      metadata: { name: "c" },
      spec: {
        conversion: {
          webhook: {
            clientConfig: { service: { name: "s", namespace: "old" } },
          },
        },
      },
    });
    assert.equal(
      crd.spec.conversion.webhook.clientConfig.service.namespace,
      "new",
    );
  });

  test("and the service an api service points at", () => {
    const [api, other] = move(
      {
        kind: "APIService",
        metadata: { name: "a" },
        spec: { service: { name: "s", namespace: "old" } },
      },
      { kind: "APIService", metadata: { name: "local" }, spec: {} },
    );
    assert.equal(api.spec.service.namespace, "new");
    assert.deepEqual(other.spec, {});
  });
});
