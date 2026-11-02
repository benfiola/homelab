import type { AppFunction } from "../../tools/lib/app.ts";
import {
  assetsServer,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.namespace();

  const secrets = h.secrets("secrets", ["admin-token"]);

  const security = h.securityContext();

  h.add({
    apiVersion: "garage.rajsingh.info/v1alpha1",
    kind: "GarageCluster",
    metadata: { name: "garage" },
    spec: {
      admin: {
        adminTokenSecretRef: secrets.key("admin-token").secretKeyRef,
        enabled: true,
      },
      containerSecurityContext: security.container,
      image: "dxflrs/garage:v2.5.0",
      podLabels: {
        "app.kubernetes.io/name": "garage",
      },
      replicas: 3,
      replication: {
        factor: 2,
      },
      security: {
        allowWorldReadableSecrets: true,
      },
      securityContext: security.pod,
      storage: {
        data: {
          size: "300Gi",
          storageClassName: "standard",
        },
        metadata: {
          storageClassName: "standard",
        },
      },
    },
  });

  h.vpa({
    kind: "GarageCluster",
    name: "garage",
    apiVersion: "garage.rajsingh.info/v1alpha1",
  });
};

export const network: NetworkFunction = (n) => {
  const assets = n.subject("assets-server", assetsServer("*"));
  const garage = n.subject("garage", pod("garage", "garage"));

  assets.to(garage, tcp(3900));
  garage.to(garage, tcp(3901));
};
