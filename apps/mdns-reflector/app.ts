import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = (h) => {
  h.namespace({ privileged: true });

  const workload = h
    .daemonSet(h.app, {
      hostNetwork: true,
      securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
    })
    .addContainer(h.app, {
      image: "ghcr.io/benfiola/homelab-images/mdns-reflector:3.0.1",
      env: {
        EXTRA_INTERFACES: "mdns0",
      },
    });

  h.vpa(workload);
};
