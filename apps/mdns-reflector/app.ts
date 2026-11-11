import type { AppFunction } from "../../tools/lib/app.ts";
import {
  cidrs,
  udp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  const ns = h.namespace({ privileged: true });

  const workload = ns
    .daemonSet(h.app, {
      hostNetwork: true,
      securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
    })
    .addContainer(h.app, {
      image: "ghcr.io/benfiola/homelab-images/mdns-reflector:3.0.5",
      env: {
        EXTRA_INTERFACES: "mdns0",
      },
    });

  ns.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  n.host
    .to(cidrs("224.0.0.251/32"), udp(5353))
    .from(cidrs("224.0.0.251/32"), udp(5353));
};
