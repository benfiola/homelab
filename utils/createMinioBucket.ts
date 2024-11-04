import { Construct } from "constructs";
import {
  MinioBucket,
  MinioPolicy,
  MinioPolicyBinding,
  MinioPolicySpec,
  MinioUser,
} from "../resources/minio/bfiola.dev";
import { createSealedSecret } from "./createSealedSecret";

type Defined<V extends any> = V extends undefined ? never : V;

interface CreateMinioBucketOpts {
  name: string;
  namespace?: string;
  secretKey: string;
  tenantRef: Defined<MinioPolicySpec["tenantRef"]>;
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
  construct: Construct,
  { name, namespace, secretKey, tenantRef }: CreateMinioBucketOpts
) => {
  const secret = await createSealedSecret(construct, `${name}-minio-secret`, {
    metadata: {
      namespace: namespace,
      name: `${name}-minio-secret-key`,
    },
    stringData: {
      secretKey: secretKey,
    },
  });

  const user = new MinioUser(construct, `${name}-minio-user`, {
    metadata: {
      namespace: namespace,
      name: name,
    },
    spec: {
      accessKey: name,
      secretKeyRef: {
        key: "secretKey",
        namespace: secret.metadata.namespace,
        name: secret.name,
      },
      tenantRef,
    },
  });

  new MinioBucket(construct, `${name}-minio-bucket`, {
    metadata: {
      namespace,
      name,
    },
    spec: {
      deletionPolicy: "IfEmpty",
      name,
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
      resource: [`arn:aws:s3:::${name}/*`],
    },
    {
      effect: "Allow",
      action: [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
      ],
      resource: [`arn:aws:s3:::${name}`],
    },
  ];
  const policy = new MinioPolicy(construct, `${name}-minio-policy`, {
    metadata: {
      namespace,
      name,
    },
    spec: {
      name,
      statement,
      tenantRef,
    },
  });

  new MinioPolicyBinding(construct, `${name}-minio-policy-binding`, {
    metadata: {
      namespace,
      name,
    },
    spec: {
      policy: policy.name,
      tenantRef,
      user: {
        builtin: user.name,
      },
    },
  });
};
