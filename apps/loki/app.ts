import type { AppFunction } from "../../tools/lib/app.ts";
import { dashboard } from "../../tools/lib/k8s/monitoring.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  // loki stores its data in garage, and reads the key from the Secret garage generates
  const key = ns.garageKey(h.app);
  const security = h.securityContext();

  // the datasource grafana queries loki through
  ns.add({
    apiVersion: "grafana.integreatly.org/v1beta1",
    kind: "GrafanaDatasource",
    metadata: { name: "loki" },
    spec: {
      allowCrossNamespaceImport: true,
      datasource: {
        access: "proxy",
        editable: false,
        name: "Loki",
        type: "loki",
        url: "http://loki-gateway.loki.svc",
      },
      instanceSelector: { matchLabels: { instance: "grafana" } },
    },
  });

  await ns.helm("https://grafana.github.io/helm-charts/loki?version=7.5.0", {
    values: {
      clusterLabelOverride: "cluster.fiola.dev",
      backend: { replicas: 0 },
      deploymentMode: "SingleBinary",
      gateway: {
        livenessProbe: {
          httpGet: { path: "/", port: "http-metrics" },
          timeoutSeconds: 5,
          failureThreshold: 6,
        },
        containerSecurityContext: security.container,
        podSecurityContext: security.pod,
      },
      loki: {
        analytics: { reporting_enabled: false },
        auth_enabled: false,
        commonConfig: { replication_factor: 1 },
        compactor: { delete_request_store: "s3", retention_enabled: true },
        containerSecurityContext: security.container,
        ingester: { chunk_encoding: "snappy" },
        livenessProbe: {
          httpGet: {
            path: "/loki/api/v1/status/buildinfo",
            port: "http-metrics",
          },
          timeoutSeconds: 5,
          failureThreshold: 6,
        },
        limits_config: {
          allow_structured_metadata: true,
          retention_period: "168h",
          // aggregated hubble policy verdicts (see apps/cilium): small, and stale policies only show
          // up over weeks
          retention_stream: [
            {
              selector: '{namespace="cilium", container="hubble-flows"}',
              priority: 1,
              period: "2160h",
            },
          ],
          volume_enabled: true,
        },
        pattern_ingester: { enabled: true },
        podSecurityContext: security.pod,
        querier: { max_concurrent: 1 },
        schemaConfig: {
          configs: [
            {
              from: "2024-04-01",
              index: { prefix: "loki_index_", period: "24h" },
              object_store: "s3",
              schema: "v13",
              store: "tsdb",
            },
          ],
        },
        storage: {
          bucketNames: {
            admin: "loki-admin",
            chunks: "loki-chunks",
            ruler: "loki-ruler",
          },
          type: "s3",
          s3: {
            accessKeyId: "${S3_ACCESS_KEY_ID}",
            endpoint: "garage.garage.svc:3900",
            insecure: true,
            region: "garage",
            s3ForcePathStyle: true,
            secretAccessKey: "${S3_SECRET_ACCESS_KEY}",
          },
        },
      },
      lokiCanary: { enabled: false },
      memcached: {
        containerSecurityContext: security.container,
        podSecurityContext: security.pod,
      },
      minio: { enabled: false },
      monitoring: {
        dashboards: { enabled: true, annotations: { grafana_folder: h.app } },
        rules: { enabled: true },
        serviceMonitor: { enabled: true },
      },
      resultsCache: {
        resources: { requests: { memory: "128Mi" }, limits: null },
      },
      chunksCache: {
        resources: { requests: { memory: "3072Mi" }, limits: null },
      },
      read: { replicas: 0 },
      singleBinary: {
        extraArgs: ["--config.expand-env=true"],
        extraEnv: [
          {
            name: "S3_ACCESS_KEY_ID",
            valueFrom: {
              secretKeyRef: {
                name: key.secret,
                key: key.accessKeyIdKey,
              },
            },
          },
          {
            name: "S3_SECRET_ACCESS_KEY",
            valueFrom: {
              secretKeyRef: {
                name: key.secret,
                key: key.secretAccessKeyKey,
              },
            },
          },
        ],
        persistence: { storageClass: "standard" },
        replicas: 1,
      },
      test: { enabled: false },
      write: { replicas: 0 },
    },
  });

  ns.garageBucket(`${h.app}-admin`, [key]);
  ns.garageBucket(`${h.app}-chunks`, [key]);
  ns.garageBucket(`${h.app}-ruler`, [key]);

  h.postRender((e) => {
    const jobs = "(loki|enterprise-logs)";
    dashboard(e, ["loki-dashboards-1", "loki-dashboards-2"], (d) => {
      for (const role of ["read", "write"]) {
        d.replace(`${jobs}-${role}.*`, `${jobs}-[0-9]+`);
        d.replace(`${jobs}-${role}`, jobs);
      }
      d.replace("$namespace/ingester", "$namespace/loki")
        .dropRows("Consul", "Big Table", "GCS", "Dynamo", "Azure Blob")
        .dropDashboards("loki-mixin-recording-rules.json");
    });
  });

  ns.vpa({ kind: "StatefulSet", name: "loki-chunks-cache" });
  ns.vpa({ kind: "StatefulSet", name: "loki" });
  ns.vpa({ kind: "Deployment", name: "loki-gateway" });
  ns.vpa({ kind: "StatefulSet", name: "loki-results-cache" });
};

export const network: NetworkFunction = (n) => {
  const loki = n.subject("loki", component("single-binary", "loki"));
  const lokiGateway = n.subject("loki-gateway", component("gateway", "loki"));
  const lokiMemcachedChunksCache = n.subject(
    "loki-memcached-chunks-cache",
    component("memcached-chunks-cache", "loki"),
  );
  const lokiMemcachedResultsCache = n.subject(
    "loki-memcached-results-cache",
    component("memcached-results-cache", "loki"),
  );

  loki
    .to(n.kubeApiServer, tcp(6443))
    .to(n.ref("garage"), tcp(3900))
    .to(lokiMemcachedChunksCache, tcp(11211))
    .to(lokiMemcachedResultsCache, tcp(11211));
  n.host.to(loki, tcp(3100));
  n.ref("prometheus").to(loki, tcp(3100));

  lokiGateway.to(loki, tcp(3100));
  n.host.to(lokiGateway, tcp(8080));
  n.ref("prometheus").to(lokiGateway, tcp(8080));

  n.host.to(lokiMemcachedChunksCache, tcp(9150, 11211));
  n.ref("prometheus").to(lokiMemcachedChunksCache, tcp(9150));

  n.host.to(lokiMemcachedResultsCache, tcp(9150, 11211));
  n.ref("prometheus").to(lokiMemcachedResultsCache, tcp(9150));
};
