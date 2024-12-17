import { Chart, Helm } from "cdk8s";
import { dump as yamlDump } from "js-yaml";
import { ConfigMap, Namespace } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createMinioBucket } from "../utils/createMinioBucket";
import { createMinioBucketAdminPolicy } from "../utils/createMinioBucketAdminPolicy";
import { createMinioPolicyBinding } from "../utils/createMinioPolicyBinding";
import { createMinioUser } from "../utils/createMinioUser";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { getPodRequests } from "../utils/getPodRequests";
import { getStorageClassName } from "../utils/getStorageClassName";
import { parseEnv } from "../utils/parseEnv";

const appData = {
  chart: "loki",
  version: "6.23.0",
  repo: "https://grafana.github.io/helm-charts",
};

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    LOKI_MINIO_SECRET_KEY: zod.string(),
  }));

  const chart = new Chart(app, "loki", {
    namespace: "loki",
  });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "loki-backend" },
      to: {
        entity: "kube-apiserver",
        ports: [[6443, "tcp"]],
      },
    },

    {
      from: { pod: "loki-backend" },
      to: {
        externalPod: ["minio", "minio-tenant"],
        ports: [[9000, "tcp"]],
      },
    },
    {
      from: { pod: "loki-read" },
      to: {
        externalPod: ["minio", "minio-tenant"],
        ports: [[9000, "tcp"]],
      },
    },
    {
      from: { pod: "loki-write" },
      to: {
        externalPod: ["minio", "minio-tenant"],
        ports: [[9000, "tcp"]],
      },
    },

    {
      from: { pod: "loki-backend" },
      to: {
        pod: "loki-backend",
        ports: [[7946, "tcp"]],
      },
    },
    {
      from: { pod: "loki-read" },
      to: {
        pod: "loki-backend",
        ports: [
          [7946, "tcp"],
          [9095, "tcp"],
        ],
      },
    },
    {
      from: { pod: "loki-write" },
      to: {
        pod: "loki-backend",
        ports: [[7946, "tcp"]],
      },
    },
    {
      from: { pod: "loki-read" },
      to: {
        pod: "loki-chunks-cache",
        ports: [[11211, "tcp"]],
      },
    },
    {
      from: { pod: "loki-write" },
      to: {
        pod: "loki-chunks-cache",
        ports: [[11211, "tcp"]],
      },
    },
    {
      from: { externalPod: ["kube-prometheus", "kube-prometheus-grafana"] },
      to: {
        pod: "loki-gateway",
        ports: [[8080, "tcp"]],
      },
    },
    {
      from: { pod: "loki-backend" },
      to: {
        pod: "loki-read",
        ports: [[7946, "tcp"]],
      },
    },
    {
      from: { pod: "loki-gateway" },
      to: {
        pod: "loki-read",
        ports: [[3100, "tcp"]],
      },
    },
    {
      from: { pod: "loki-read" },
      to: {
        pod: "loki-read",
        ports: [
          [7946, "tcp"],
          [9095, "tcp"],
        ],
      },
    },
    {
      from: { pod: "loki-write" },
      to: {
        pod: "loki-read",
        ports: [[7946, "tcp"]],
      },
    },
    {
      from: { pod: "loki-read" },
      to: {
        pod: "loki-results-cache",
        ports: [[11211, "tcp"]],
      },
    },
    {
      from: { pod: "loki-backend" },
      to: {
        pod: "loki-write",
        ports: [[7946, "tcp"]],
      },
    },
    {
      from: { pod: "loki-gateway" },
      to: {
        pod: "loki-write",
        ports: [[3100, "tcp"]],
      },
    },
    {
      from: { pod: "loki-read" },
      to: {
        pod: "loki-write",
        ports: [
          [7946, "tcp"],
          [9095, "tcp"],
        ],
      },
    },
    {
      from: { pod: "loki-write" },
      to: {
        pod: "loki-write",
        ports: [
          [7946, "tcp"],
          [9095, "tcp"],
        ],
      },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const lokiMinioUser = await createMinioUser(
    chart,
    "loki",
    env.LOKI_MINIO_SECRET_KEY
  );
  const lokiMinioBucketAdmin = createMinioBucket(chart, "loki-admin");
  const lokiMinioBucketChunks = createMinioBucket(chart, "loki-chunks");
  const lokiMinioBucketRuler = createMinioBucket(chart, "loki-ruler");
  const lokiMinioPolicyAdmin = createMinioBucketAdminPolicy(
    chart,
    lokiMinioBucketAdmin.name
  );
  const lokiMinioPolicyChunks = createMinioBucketAdminPolicy(
    chart,
    lokiMinioBucketChunks.name
  );
  const lokiMinioPolicyRuler = createMinioBucketAdminPolicy(
    chart,
    lokiMinioBucketRuler.name
  );
  createMinioPolicyBinding(
    chart,
    lokiMinioPolicyAdmin.name,
    lokiMinioUser.name
  );
  createMinioPolicyBinding(
    chart,
    lokiMinioPolicyChunks.name,
    lokiMinioUser.name
  );
  createMinioPolicyBinding(
    chart,
    lokiMinioPolicyRuler.name,
    lokiMinioUser.name
  );

  new Helm(chart, "helm", {
    ...appData,
    namespace: chart.namespace,
    values: {
      backend: {
        // persistence required for fault-tolerance
        persistence: {
          storageClass: getStorageClassName(),
          volumeClaimsEnabled: true,
        },
      },
      // deploy loki in 'simple scalable' mode
      deploymentMode: "SimpleScalable",
      // give helm release a more concise name
      fullnameOverride: "loki",
      loki: {
        auth_enabled: false,
        schemaConfig: {
          configs: [
            {
              // default (but required) schema configuration
              from: "2024-04-01",
              index: {
                prefix: "loki_index_",
                period: "24h",
              },
              object_store: "s3",
              schema: "v13",
              store: "tsdb",
            },
          ],
        },
        storage: {
          bucketNames: {
            // customize required bucket names
            admin: lokiMinioBucketAdmin.name,
            chunks: lokiMinioBucketChunks.name,
            ruler: lokiMinioBucketRuler.name,
          },
          type: "s3",
          s3: {
            // configure loki to use internal minio as storage
            accessKeyId: lokiMinioUser.name,
            endpoint: "minio.minio.svc",
            insecure: true,
            s3ForcePathStyle: true,
            secretAccessKey: env.LOKI_MINIO_SECRET_KEY,
          },
        },
      },
      lokiCanary: {
        // disable the canary used to validate a working installation
        enabled: false,
      },
      read: {
        // persistence required for fault-tolerance
        persistence: {
          storageClass: getStorageClassName(),
          volumeClaimsEnabled: true,
        },
        // ensure read workloads have sufficient memory
        resources: getPodRequests({ mem: 300 }),
      },
      test: {
        // disable manifests intended to test the helm release
        enabled: false,
      },
      write: {
        // persistence required for fault-tolerance
        persistence: {
          storageClass: getStorageClassName(),
          volumeClaimsEnabled: true,
        },
        // ensure write workloads have sufficient memory
        resources: getPodRequests({ mem: 1000 }),
      },
    },
  });

  new ConfigMap(chart, "config-map-datasource-loki", {
    metadata: {
      namespace: chart.namespace,
      name: "loki-grafana-datasource",
      labels: { grafana_datasource: "1" },
    },
    data: {
      [`datasources-${chart.namespace}.yaml`]: yamlDump({
        apiVersion: 1,
        datasources: [
          {
            uid: "loki",
            name: "Loki",
            type: "loki",
            access: "proxy",
            url: "http://loki-gateway.loki",
          },
        ],
      }),
    },
  });
  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
