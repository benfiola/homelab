import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "oci://registry.k8s.io/nfd/charts/node-feature-discovery?version=0.18.3",
    { values: "values.yaml" },
  );

  h.namespace({ privileged: true });

  h.vpa({ kind: "Deployment", name: "node-feature-discovery-master" });

  h.vpa({ kind: "Deployment", name: "node-feature-discovery-gc" });
};

export const network: NetworkFunction = (n) => {
  const nodeFeatureDiscovery = n.subject(
    "node-feature-discovery",
    pod("node-feature-discovery", "node-feature-discovery"),
  );

  nodeFeatureDiscovery.to(n.kubeApiServer, tcp(6443));
  n.host.to(nodeFeatureDiscovery, tcp(8080));
};
