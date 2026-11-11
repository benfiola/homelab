import type { AppFunction } from "../../tools/lib/app.ts";
import { PolicyRegistry } from "../../tools/lib/k8s/network-policy.ts";

// the policies of the whole cluster, from the `network` of every app. the cluster's infrastructure
// (nodes, the host, dns) is declared by the cilium app.
export const app: AppFunction = async (h) => {
  const registry = new PolicyRegistry();

  for (const name of h.apps) {
    const network = await h.networkFunction(name);
    network?.(registry.network(name));
  }

  h.namespace().add(...registry.objects());
};
