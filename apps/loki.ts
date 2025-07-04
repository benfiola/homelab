import { Chart, Helm } from "cdk8s";
import { dump as yamlDump } from "js-yaml";
import { ConfigMap, Namespace } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createMinioBucket } from "../utils/createMinioBucket";
import { createMinioBucketAdminPolicy } from "../utils/createMinioBucketAdminPolicy";
import { createMinioPolicyBinding } from "../utils/createMinioPolicyBinding";
import { createMinioUser } from "../utils/createMinioUser";
import {
  createNetworkPolicy,
  createTargets,
} from "../utils/createNetworkPolicy";
import { getPodRequests } from "../utils/getPodRequests";
import { getStorageClassName } from "../utils/getStorageClassName";
import { parseEnv } from "../utils/parseEnv";

const helmData = {
  chart: "loki",
  version: "6.30.1",
  repo: "https://grafana.github.io/helm-charts",
};

const namespace = "loki";

export const policyTargets = createTargets((b) => ({
  chunksCache: b.pod(namespace, "loki-chunks-cache", { api: [11211, "tcp"] }),
  backend: b.pod(namespace, "loki-backend", {
    ad: [7946, "tcp"],
    grpc: [9095, "tcp"],
  }),
  gateway: b.pod(namespace, "loki-gateway", { api: [8080, "tcp"] }),
  read: b.pod(namespace, "loki-read", {
    ad: [7946, "tcp"],
    grpc: [9095, "tcp"],
    http: [3100, "tcp"],
  }),
  resultsCache: b.pod(namespace, "loki-results-cache", { api: [11211, "tcp"] }),
  write: b.pod(namespace, "loki-write", {
    ad: [7946, "tcp"],
    grpc: [9095, "tcp"],
    http: [3100, "tcp"],
  }),
}));

const manifests: ManifestsCallback = async (app) => {
  const { policyTargets: kubeTargets } = await import("./k8s");
  const { policyTargets: kpromTargets } = await import("./kube-prometheus");
  const { policyTargets: minioTargets } = await import("./minio");

  const env = parseEnv((zod) => ({
    LOKI_MINIO_SECRET_KEY: zod.string(),
  }));

  const chart = new Chart(app, "loki", {
    namespace,
  });

  createNetworkPolicy(chart, (b) => {
    const kt = kubeTargets;
    const kpt = kpromTargets;
    const mt = minioTargets;
    const pt = policyTargets;

    b.rule(kpt.grafana, pt.gateway, "api");
    b.rule(pt.backend, mt.tenant, "api");
    b.rule(pt.backend, pt.backend, "ad");
    b.rule(pt.backend, pt.read, "ad");
    b.rule(pt.backend, pt.write, "ad");
    b.rule(pt.backend, kt.apiServer, "api");
    b.rule(pt.gateway, pt.read, "http");
    b.rule(pt.gateway, pt.write, "http");
    b.rule(pt.read, mt.tenant, "api");
    b.rule(pt.read, pt.backend, "ad", "grpc");
    b.rule(pt.read, pt.chunksCache, "api");
    b.rule(pt.read, pt.read, "ad", "grpc");
    b.rule(pt.read, pt.resultsCache, "api");
    b.rule(pt.read, pt.write, "ad", "grpc");
    b.rule(pt.write, mt.tenant, "api");
    b.rule(pt.write, pt.backend, "ad");
    b.rule(pt.write, pt.read, "ad");
    b.rule(pt.write, pt.write, "ad", "grpc");
    b.rule(pt.write, pt.chunksCache, "api");
  });

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
    ...helmData,
    namespace: chart.namespace,
    values: {
      backend: {
        // persistence required for fault-tolerance
        persistence: {
          storageClass: getStorageClassName(),
          volumeClaimsEnabled: true,
        },
        // ensure backend workloads have sufficient memory
        resources: getPodRequests({ mem: 300 }),
      },
      // deploy loki in 'simple scalable' mode
      deploymentMode: "SimpleScalable",
      // give helm release a more concise name
      fullnameOverride: "loki",
      loki: {
        analytics: {
          // disable phoning home to grafana
          reporting_enabled: false,
        },
        // used primarily to signal a single-tenant environment
        auth_enabled: false,
        compactor: {
          // specify storage to apply retention policies to
          delete_request_store: "s3",
          // enable log retention
          retention_enabled: true,
        },
        limits_config: {
          // define retention period for logs
          retention_period: "168h",
        },
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
