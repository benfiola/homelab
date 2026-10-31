import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm("https://helm.releases.hashicorp.com/vault?version=0.31.0", {
    values: "values.yaml",
  });

  h.namespace();

  h.vpa({ kind: "StatefulSet", name: "vault" });
  h.httpRoute("infrastructure", "secrets.fiola.dev").match(
    { kind: "Service", name: "vault" },
    8200,
  );
};

export const network: NetworkFunction = (n) => {
  const vault = n.subject("vault", pod("vault", "vault"));

  vault.to(n.kubeApiServer, tcp(6443)).to(vault, tcp(8200, 8201));
  n.ref("gateway-infrastructure").to(vault, tcp(8200));
};
