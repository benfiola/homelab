import {
  GarageCluster,
  GarageClusterSpecStorageDataSize as StorageSize,
} from "../../../assets/garage-operator/garage.rajsingh.info";
import {
  Chart,
  getSecurityContext,
  Namespace,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const vaultAuth = new VaultAuth(chart);

  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  const securityContext = getSecurityContext();

  const cluster = new GarageCluster(chart, `${id}-garage-cluster`, {
    metadata: {
      name: "garage",
    },
    spec: {
      admin: {
        adminTokenSecretRef: {
          name: vaultSecret.name,
          key: "admin-token",
        },
        enabled: true,
      },
      containerSecurityContext: securityContext.container,
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
      securityContext: securityContext.pod,
      storage: {
        data: {
          size: StorageSize.fromString("100Gi"),
          storageClassName: "standard",
        },
        metadata: {
          storageClassName: "standard",
        },
      },
    },
  });

  new VerticalPodAutoscaler(chart, cluster);

  return chart;
};
