import {
  TenantSpecPoolsVolumeClaimTemplateSpecResourcesRequests as Requests,
  Tenant,
} from "../../../assets/minio-operator/minio.min.io";
import {
  Chart,
  getField,
  getSecurityContext,
  HttpRoute,
  Namespace,
  VaultAuth,
  VaultDynamicSecret,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { textblock } from "../../strings";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const vaultAuth = new VaultAuth(
    chart,
    chart.node.id,
    "vault-secrets-operator",
  );

  const vaultSecret = new VaultDynamicSecret(
    chart,
    vaultAuth,
    "configuration",
    chart.node.id,
    {
      "config.env": textblock`
        {{- $secrets := get .Secrets "data" -}}
        export MINIO_ROOT_USER=root
        export MINIO_ROOT_PASSWORD={{ get $secrets "root-secret-key" }}
      `,
    },
  );

  const securityContext = getSecurityContext({ uid: 1000 });

  new Tenant(chart, `${id}-tenant`, {
    metadata: {
      name: "minio",
    },
    spec: {
      configuration: {
        name: getField(vaultSecret.secret, "spec.destination.name"),
      },
      pools: [
        {
          containerSecurityContext: securityContext.container,
          name: "pool",
          labels: {
            "app.kubernetes.io/name": id,
          },
          securityContext: securityContext.pod,
          servers: 3,
          volumeClaimTemplate: {
            spec: {
              accessModes: ["ReadWriteOnce"],
              resources: {
                requests: {
                  storage: Requests.fromString("10Gi"),
                },
              },
              storageClassName: "standard",
            },
          },
          volumesPerServer: 2,
        },
      ],
      requestAutoCert: false,
    },
  });

  new HttpRoute(chart, "trusted", "minio.bulia.dev").match(
    {
      name: "minio",
      kind: "Service",
    },
    80,
  );

  new HttpRoute(chart, "trusted", "console.minio.bulia.dev").match(
    {
      name: "minio-console",
      kind: "Service",
    },
    9090,
  );

  return chart;
};
