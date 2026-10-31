import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = (h) => {
  h.namespace();

  h.add({
    apiVersion: "k8s.cni.cncf.io/v1",
    kind: "NetworkAttachmentDefinition",
    metadata: {
      name: "mdns",
    },
    spec: {
      config:
        '{"cniVersion":"0.3.1","name":"mdns","type":"bridge","bridge":"mdns0","isGateway":true,"ipam":{"type":"host-local","subnet":"192.168.254.0/24"}}',
    },
  });
};
