import {
  MinioBucket,
  MinioPolicy,
  MinioPolicyBinding,
  MinioUser,
} from "../../../assets/minio-operator-ext/bfiola.dev";
import {
  Chart,
  findApiObject,
  getField,
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

  const vaultAuth = new VaultAuth(chart, "vault");

  const vaultSecret = new VaultStaticSecret(
    chart,
    vaultAuth,
    "vault",
    construct.node.id,
  );

  const tenantRef = {
    name: "minio",
    namespace: "minio",
  };

  const minioUser = new MinioUser(chart, `${id}-minio-user`, {
    metadata: {
      name: "user",
    },
    spec: {
      accessKey: id,
      tenantRef,
      secretKeyRef: {
        key: "minio-secret-key",
        name: getField(vaultSecret.secret, "spec.destination.name"),
      },
    },
  });

  const createMinioBucket = (name: string) => {
    return new MinioBucket(chart, `${id}-minio-bucket-${name}`, {
      metadata: {
        name,
      },
      spec: {
        deletionPolicy: "Always",
        name: `${id}-${name}`,
        tenantRef,
      },
    });
  };

  const minioBucketAdmin = createMinioBucket("admin");
  const minioBucketChunks = createMinioBucket("chunks");
  const minioBucketRuler = createMinioBucket("ruler");

  const minioPolicy = new MinioPolicy(chart, `${id}-minio-policy`, {
    metadata: {
      name: "policy",
    },
    spec: {
      name: id,
      statement: [
        {
          effect: "Allow",
          action: [
            "s3:AbortMultipartUpload",
            "s3:DeleteObject",
            "s3:ListMultipartUploadParts",
            "s3:PutObject",
            "s3:GetObject",
          ],
          resource: [
            `arn:aws:s3:::${getField(minioBucketAdmin, "spec.name")}/*`,
            `arn:aws:s3:::${getField(minioBucketChunks, "spec.name")}/*`,
            `arn:aws:s3:::${getField(minioBucketRuler, "spec.name")}/*`,
          ],
        },
        {
          effect: "Allow",
          action: [
            "s3:GetBucketLocation",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
          ],
          resource: [
            `arn:aws:s3:::${getField(minioBucketAdmin, "spec.name")}/*`,
            `arn:aws:s3:::${getField(minioBucketChunks, "spec.name")}/*`,
            `arn:aws:s3:::${getField(minioBucketRuler, "spec.name")}/*`,
          ],
        },
      ],
      tenantRef,
      version: "2012-10-17",
    },
  });

  new MinioPolicyBinding(chart, `${id}-minio-policy-binding`, {
    metadata: {
      name: "policy-binding",
    },
    spec: {
      policy: getField(minioPolicy, "spec.name"),
      tenantRef,
      user: {
        builtin: getField(minioUser, "spec.accessKey"),
      },
    },
  });

  const extraArgs = ["--config.expand-env=true"];
  const extraEnv = [
    {
      name: "S3_SECRET_KEY",
      valueFrom: {
        secretKeyRef: {
          name: getField(vaultSecret.secret, "spec.destination.name"),
          key: "minio-secret-key",
        },
      },
    },
  ];
  const persistence = {
    storageClass: "standard",
  };

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    backend: {
      extraArgs,
      extraEnv,
      persistence,
      replicas: 1,
    },
    deploymentMode: "SimpleScalable",
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
          admin: getField(minioBucketAdmin, "spec.name"),
          chunks: getField(minioBucketChunks, "spec.name"),
          ruler: getField(minioBucketRuler, "spec.name"),
        },
        type: "s3",
        s3: {
          accessKeyId: getField(minioUser, "spec.accessKey"),
          endpoint: "minio.minio.svc",
          insecure: true,
          s3ForcePathStyle: true,
          secretAccessKey: "${S3_SECRET_KEY}",
        },
      },
    },
    lokiCanary: {
      enabled: false,
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
