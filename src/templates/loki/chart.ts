import { GarageBucket } from "../../../assets/garage-operator/garage.rajsingh.info";
import {
  Chart,
  findApiObject,
  GarageKey,
  getSecurityContext,
  Helm,
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

  const auth = new VaultAuth(chart);

  const secret = new VaultStaticSecret(chart, auth);

  const key = new GarageKey(chart, "garage", id, auth, {
    accessKeyId: "s3-access-key-id",
    secretAccessKey: "s3-secret-access-key",
  });

  const bucketSpec = {
    clusterRef: {
      name: "garage",
      namespace: "garage",
    },
    keyPermissions: [
      {
        keyRef: key.name,
        read: true,
        write: true,
      },
    ],
  };

  const adminBucket = new GarageBucket(chart, `${id}-garage-bucket-admin`, {
    metadata: {
      name: `${id}-admin`,
    },
    spec: bucketSpec,
  });

  const chunksBucket = new GarageBucket(chart, `${id}-garage-bucket-chunks`, {
    metadata: {
      name: `${id}-chunks`,
    },
    spec: bucketSpec,
  });

  const rulerBucket = new GarageBucket(chart, `${id}-garage-bucket-ruler`, {
    metadata: {
      name: `${id}-ruler`,
    },
    spec: bucketSpec,
  });

  const extraArgs = ["--config.expand-env=true"];
  const extraEnv = [
    {
      name: "S3_ACCESS_KEY_ID",
      valueFrom: {
        secretKeyRef: {
          name: secret.name,
          key: "s3-access-key-id",
        },
      },
    },
    {
      name: "S3_SECRET_ACCESS_KEY",
      valueFrom: {
        secretKeyRef: {
          name: secret.name,
          key: "s3-secret-access-key",
        },
      },
    },
  ];
  const persistence = {
    storageClass: "standard",
  };
  const securityContext = getSecurityContext();

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    backend: {
      extraArgs,
      extraEnv,
      persistence,
      replicas: 1,
    },
    deploymentMode: "SimpleScalable",
    gateway: {
      containerSecurityContext: securityContext.container,
      podSecurityContext: securityContext.pod,
    },
    loki: {
      analytics: {
        reporting_enabled: false,
      },
      auth_enabled: false,
      commonConfig: {
        replication_factor: 1,
      },
      compactor: {
        delete_request_store: "s3",
        retention_enabled: true,
      },
      containerSecurityContext: securityContext.container,
      ingester: {
        chunk_encoding: "snappy",
      },
      limits_config: {
        allow_structured_metadata: true,
        retention_period: "168h",
        volume_enabled: true,
      },
      pattern_ingester: {
        enabled: true,
      },
      podSecurityContext: securityContext.pod,
      querier: {
        max_concurrent: 1,
      },
      schemaConfig: {
        configs: [
          {
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
          admin: adminBucket.name,
          chunks: chunksBucket.name,
          ruler: rulerBucket.name,
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
    lokiCanary: {
      enabled: false,
    },
    memcached: {
      containerSecurityContext: securityContext.container,
      podSecurityContext: securityContext.pod,
    },
    minio: {
      enabled: false,
    },
    read: {
      extraArgs,
      extraEnv,
      persistence,
      replicas: 1,
    },
    test: {
      enabled: false,
    },
    write: {
      extraArgs,
      extraEnv,
      persistence,
      replicas: 1,
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      name: "loki-backend",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      name: "loki-chunks-cache",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "loki-gateway",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "loki-read",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      name: "loki-results-cache",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      name: "loki-write",
    }),
  );

  return chart;
};
