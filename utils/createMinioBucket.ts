import { Chart } from "cdk8s";
import {
  MinioBucket,
  MinioPolicy,
  MinioPolicyBinding,
  MinioUser,
} from "../resources/minio/bfiola.dev";
import { createSealedSecret } from "./createSealedSecret";

type Defined<V extends any> = V extends undefined ? never : V;

interface CreateMinioBucketOpts {
  name: string;
  secretKey: string;
}

/**
 * Helper method that creates a bucket and an admin user for that bucket.
 *
 * It creates:
 * - A sealed secret called `${name}-minio-secret-key` with the minio user secret key stored at 'secretKey'
 * - A minio user
 * - A minio bucket
 * - An admin policy for the minio bucket
 * - A policy binding connecting the minio user with the minio policy
 */
export const createMinioBucket = async (
  chart: Chart,
  id: string,
  opts: CreateMinioBucketOpts
) => {
  const accessKey = `${opts.name}-default`;

  const secret = await createSealedSecret(chart, `${id}-secret`, {
    metadata: {
      namespace: chart.namespace,
      name: `${accessKey}-secret-key`,
    },
    stringData: {
      secretKey: opts.secretKey,
    },
  });

  const tenantRef = {
    name: "minio-tenant",
    namespace: "minio",
  };

  const user = new MinioUser(chart, `${id}-minio-user`, {
    metadata: {
      namespace: chart.namespace,
      name: accessKey,
    },
    spec: {
      accessKey: accessKey,
      secretKeyRef: {
        key: "secretKey",
        namespace: secret.metadata.namespace,
        name: secret.name,
      },
      tenantRef,
    },
  });

  new MinioBucket(chart, `${id}-bucket`, {
    metadata: {
      namespace: chart.namespace,
      name: opts.name,
    },
    spec: {
      deletionPolicy: "IfEmpty",
      name: opts.name,
      tenantRef,
    },
  });

  const statement = [
    {
      effect: "Allow",
      action: [
        "s3:AbortMultipartUpload",
        "s3:DeleteObject",
        "s3:ListMultipartUploadParts",
        "s3:PutObject",
        "s3:GetObject",
      ],
      resource: [`arn:aws:s3:::${opts.name}/*`],
    },
    {
      effect: "Allow",
      action: [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
      ],
      resource: [`arn:aws:s3:::${opts.name}`],
    },
  ];
  const policyName = `${opts.name}-admin`;
  const policy = new MinioPolicy(chart, `${id}-policy`, {
    metadata: {
      namespace: chart.namespace,
      name: policyName,
    },
    spec: {
      name: policyName,
      statement,
      tenantRef,
      version: "2012-10-17",
    },
  });

  new MinioPolicyBinding(chart, `${id}-policy-binding`, {
    metadata: {
      namespace: chart.namespace,
      name: policy.name,
    },
    spec: {
      policy: policy.name,
      tenantRef,
      user: {
        builtin: accessKey,
      },
    },
  });
};
