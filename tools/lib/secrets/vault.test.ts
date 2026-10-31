import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  appSecrets,
  appTemplatedSecrets,
  secretName,
  secretRef,
  vaultAuth,
  vaultStaticSecret,
  vaultTemplatedSecret,
} from "./vault.ts";

describe("vaultAuth", () => {
  test("binds the operator's service account to a vault role", () => {
    const auth = vaultAuth({ role: "app" });
    assert.equal(auth.name, "app");
    assert.deepEqual(auth.objects, [
      {
        apiVersion: "v1",
        kind: "ServiceAccount",
        metadata: { name: "vault-secrets-operator" },
      },
      {
        apiVersion: "secrets.hashicorp.com/v1beta1",
        kind: "VaultAuth",
        metadata: { name: "app" },
        spec: {
          kubernetes: { role: "app", serviceAccount: "vault-secrets-operator" },
          method: "kubernetes",
          mount: "kubernetes",
        },
      },
    ]);
  });

  test("takes a different service account", () => {
    const [serviceAccount, auth] = vaultAuth({
      role: "r",
      serviceAccount: "sa",
    }).objects;
    assert.equal(serviceAccount.metadata.name, "sa");
    assert.equal(auth.spec.kubernetes.serviceAccount, "sa");
  });
});

describe("vaultStaticSecret", () => {
  test("copies a vault path into a Secret", () => {
    const secret = vaultStaticSecret({
      auth: vaultAuth({ role: "app" }),
      path: "app",
    });
    assert.deepEqual(secret, {
      apiVersion: "secrets.hashicorp.com/v1beta1",
      kind: "VaultStaticSecret",
      metadata: { name: "secrets" },
      spec: {
        destination: { create: true, name: "secrets" },
        mount: "secrets",
        path: "app",
        type: "kv-v2",
        vaultAuthRef: "app",
      },
    });
  });

  test("names the Secret", () => {
    const secret = vaultStaticSecret({
      auth: vaultAuth({ role: "a" }),
      name: "other",
      path: "p",
    });
    assert.equal(secret.metadata.name, "other");
    assert.equal(secret.spec.destination.name, "other");
  });
});

describe("vaultTemplatedSecret", () => {
  test("builds a Secret from templates over a vault path", () => {
    const secret = vaultTemplatedSecret({
      auth: vaultAuth({ role: "app" }),
      path: "app",
      templates: { PASSWORD: secretRef("smtp-password"), STATIC: "x" },
    });
    assert.equal(secret.kind, "VaultDynamicSecret");
    assert.equal(secret.spec.path, "data/app");
    assert.deepEqual(secret.spec.destination.transformation.templates, {
      PASSWORD: { text: '{{ get (get .Secrets "data") "smtp-password" }}' },
      STATIC: { text: "x" },
    });
  });
});

describe("appSecrets", () => {
  test("is a service account, a vault auth and a Secret named after the contract", () => {
    const objects = appSecrets("cert-manager");
    assert.deepEqual(
      objects.map((o) => o.kind),
      ["ServiceAccount", "VaultAuth", "VaultStaticSecret"],
    );
    assert.equal(objects[2].spec.path, "cert-manager");
    assert.equal(objects[2].metadata.name, secretName);
    assert.equal(objects[2].spec.vaultAuthRef, "cert-manager");
  });

  test("the templated variant swaps the last object", () => {
    const objects = appTemplatedSecrets("postfix", { A: "b" });
    assert.deepEqual(
      objects.map((o) => o.kind),
      ["ServiceAccount", "VaultAuth", "VaultDynamicSecret"],
    );
    assert.equal(objects[2].spec.path, "data/postfix");
    assert.equal(objects[2].spec.destination.create, true);
  });
});
