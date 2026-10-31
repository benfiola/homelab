import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "oci://ghcr.io/benfiola/homelab-images/charts/vault-push-secrets?version=1.0.9",
    { values: "values.yaml" },
  );

  h.namespace();

  h.secrets();

  h.vpa({ kind: "Deployment", name: "vault-push-secrets" });
};

export const network: NetworkFunction = (n) => {
  const vaultPushSecrets = n.subject(
    "vault-push-secrets",
    pod("vault-push-secrets", "vault-push-secrets"),
  );

  vaultPushSecrets
    .to(dns("identity.bitwarden.com"), tcp(443))
    .to(n.ref("vault"), tcp(8200));
};
