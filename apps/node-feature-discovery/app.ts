import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace({ privileged: true });

  await ns.helm(
    "oci://registry.k8s.io/nfd/charts/node-feature-discovery?version=0.20.1",
    {
      values: {
        master: { resources: { limits: null } },
        worker: {
          config: { core: { labelSources: ["kernel", "pci", "system"] } },
          resources: { limits: null },
        },
        gc: { resources: { limits: null } },
      },
    },
  );

  ns.vpa({ kind: "Deployment", name: "node-feature-discovery-master" });

  ns.vpa({ kind: "Deployment", name: "node-feature-discovery-gc" });
};

export const network: NetworkFunction = (n) => {
  const nodeFeatureDiscovery = n.subject(
    "node-feature-discovery",
    pod("node-feature-discovery", "node-feature-discovery"),
  );

  nodeFeatureDiscovery.to(n.kubeApiServer, tcp(6443));
  n.host.to(nodeFeatureDiscovery, tcp(8080));
};
