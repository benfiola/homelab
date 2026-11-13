import type { AppFunction } from "../../tools/lib/app.ts";
import {
  assetsServer,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  const ns = h.namespace();

  const secrets = ns.templatedSecrets("secrets", {
    "admin-token": h.generatedRef("garage-admin-token"),
  });

  const security = h.securityContext();

  ns.add({
    apiVersion: "garage.rajsingh.info/v1beta2",
    kind: "GarageCluster",
    metadata: { name: "garage" },
    spec: {
      admin: {
        adminTokenSecretRef: secrets.key("admin-token").secretKeyRef,
      },
      image: "dxflrs/garage:v2.5.0",
      monitoring: { enabled: true },
      replication: {
        factor: 2,
      },
      security: {
        allowInsecureSecretPermissions: true,
      },
      storage: {
        containerSecurityContext: security.container,
        replicas: 3,
        securityContext: security.pod,
        data: {
          size: "300Gi",
          storageClassName: "standard",
        },
        metadata: {
          size: "10Gi",
          storageClassName: "standard",
        },
      },
    },
  });

  ns.vpa({
    kind: "GarageCluster",
    name: "garage",
    apiVersion: "garage.rajsingh.info/v1beta2",
  });
};

export const network: NetworkFunction = (n) => {
  const assets = n.subject("assets-server", assetsServer("*"));
  const garage = n.subject("garage", pod("garage", "garage"));

  assets.to(garage, tcp(3900));

  garage.to(garage, tcp(3901));
  n.ref("prometheus").to(garage, tcp(3903));
};
