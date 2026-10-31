type Obj = Record<string, any>;

const bindings = new Set(["RoleBinding", "ClusterRoleBinding"]);
const webhooks = new Set([
  "ValidatingWebhookConfiguration",
  "MutatingWebhookConfiguration",
]);

// moves objects into a namespace: each takes it (a Namespace object is renamed to it), and so do the
// references to the old one: service accounts a binding names, services a webhook calls
export const moveToNamespace = (objects: Obj[], namespace: string): Obj[] => {
  const accounts = new Set(
    objects
      .filter((o) => o.kind === "ServiceAccount")
      .map((o) => o.metadata.name),
  );
  for (const obj of objects) {
    obj.metadata = { ...obj.metadata, namespace };
    // a Namespace object is the namespace, so it is renamed
    if (obj.kind === "Namespace") {
      obj.metadata.name = namespace;
    }
    if (bindings.has(obj.kind)) {
      for (const subject of obj.subjects ?? []) {
        if (
          subject.kind === "ServiceAccount" &&
          (subject.name === "default" || accounts.has(subject.name))
        ) {
          subject.namespace = namespace;
        }
      }
    }
    if (webhooks.has(obj.kind)) {
      for (const webhook of obj.webhooks ?? []) {
        if (webhook.clientConfig?.service) {
          webhook.clientConfig.service.namespace = namespace;
        }
      }
    }
    if (
      obj.kind === "CustomResourceDefinition" &&
      obj.spec?.conversion?.webhook?.clientConfig?.service
    ) {
      obj.spec.conversion.webhook.clientConfig.service.namespace = namespace;
    }
    if (obj.kind === "APIService" && obj.spec?.service) {
      obj.spec.service.namespace = namespace;
    }
  }
  return objects;
};
