import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  // loki stores its data in garage, and reads the key from the Secret garage generates
  const key = h.garageKey(h.app);

  h.helm("https://grafana.github.io/helm-charts/loki?version=7.5.0", {
    values: {
      backend: { replicas: 0 },
      deploymentMode: "SingleBinary",
      gateway: {
        containerSecurityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"], add: [] },
          runAsNonRoot: true,
          runAsUser: 65534,
          runAsGroup: 65534,
        },
        podSecurityContext: {
          fsGroup: 65534,
          runAsNonRoot: true,
          runAsUser: 65534,
          runAsGroup: 65534,
          seccompProfile: { type: "RuntimeDefault" },
        },
      },
      loki: {
        analytics: { reporting_enabled: false },
        auth_enabled: false,
        commonConfig: { replication_factor: 1 },
        compactor: { delete_request_store: "s3", retention_enabled: true },
        containerSecurityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"], add: [] },
          runAsNonRoot: true,
          runAsUser: 65534,
          runAsGroup: 65534,
        },
        ingester: { chunk_encoding: "snappy" },
        limits_config: {
          allow_structured_metadata: true,
          retention_period: "168h",
          volume_enabled: true,
        },
        pattern_ingester: { enabled: true },
        podSecurityContext: {
          fsGroup: 65534,
          runAsNonRoot: true,
          runAsUser: 65534,
          runAsGroup: 65534,
          seccompProfile: { type: "RuntimeDefault" },
        },
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
        containerSecurityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"], add: [] },
          runAsNonRoot: true,
          runAsUser: 65534,
          runAsGroup: 65534,
        },
        podSecurityContext: {
          fsGroup: 65534,
          runAsNonRoot: true,
          runAsUser: 65534,
          runAsGroup: 65534,
          seccompProfile: { type: "RuntimeDefault" },
        },
      },
      minio: { enabled: false },
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

  h.namespace();

  h.garageBucket(`${h.app}-admin`, [key]);
  h.garageBucket(`${h.app}-chunks`, [key]);
  h.garageBucket(`${h.app}-ruler`, [key]);

  h.vpa({ kind: "StatefulSet", name: "loki-chunks-cache" });
  h.vpa({ kind: "StatefulSet", name: "loki" });
  h.vpa({ kind: "Deployment", name: "loki-gateway" });
  h.vpa({ kind: "StatefulSet", name: "loki-results-cache" });
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
  lokiGateway.to(loki, tcp(3100));
  n.host.to(lokiGateway, tcp(8080));
  n.host.to(lokiMemcachedChunksCache, tcp(9150, 11211));
  n.host.to(lokiMemcachedResultsCache, tcp(9150, 11211));
};
