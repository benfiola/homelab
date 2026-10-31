import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "https://helm.releases.hashicorp.com/vault-secrets-operator?version=1.0.1",
    { values: "values.yaml" },
  );

  h.namespace();

  h.add({
    apiVersion: "secrets.hashicorp.com/v1beta1",
    kind: "VaultConnection",
    metadata: {
      name: "default",
    },
    spec: {
      address: "http://vault.vault:8200",
      skipTLSVerify: false,
    },
  });

  h.vpa({
    kind: "Deployment",
    name: "vault-secrets-operator-controller-manager",
  });
};

export const network: NetworkFunction = (n) => {
  const vaultSecretsOperator = n.subject(
    "vault-secrets-operator",
    pod("vault-secrets-operator", "vault-secrets-operator"),
  );

  vaultSecretsOperator
    .to(n.kubeApiServer, tcp(6443))
    .to(n.ref("vault"), tcp(8200));
  n.host.to(vaultSecretsOperator, tcp(8081));
};
