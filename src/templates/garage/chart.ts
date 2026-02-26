import {
  GarageCluster,
  GarageClusterSpecStorageDataSize as StorageSize,
} from "../../../assets/garage-operator/garage.rajsingh.info";
import {
  Chart,
  getField,
  getSecurityContext,
  Namespace,
  VaultAuth,
  VaultStaticSecret,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const vaultAuth = new VaultAuth(
    chart,
    chart.node.id,
    "vault-secrets-operator",
  );

  const vaultSecret = new VaultStaticSecret(
    chart,
    vaultAuth,
    "secrets",
    chart.node.id,
  );

  const securityContext = getSecurityContext();

  new GarageCluster(chart, `${id}-garage-cluster`, {
    metadata: {
      name: "garage",
    },
    spec: {
      admin: {
        adminTokenSecretRef: {
          name: getField(vaultSecret.secret, "spec.destination.name"),
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
      webApi: {
        enabled: true,
      },
    },
  });

  return chart;
};
