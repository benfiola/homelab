import { Chart } from "cdk8s";
import { MinioPolicy } from "../resources/minio/bfiola.dev";

/**
 * Helper method that creates an 'admin' policy for a given bucket
 */
export const createMinioBucketAdminPolicy = (chart: Chart, bucket: string) => {
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
      resource: [`arn:aws:s3:::${bucket}/*`],
    },
    {
      effect: "Allow",
      action: [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
      ],
      resource: [`arn:aws:s3:::${bucket}`],
    },
  ];
  const policyName = `${bucket}-admin`;
  const policy = new MinioPolicy(chart, `minio-policy-admin-${bucket}`, {
    metadata: {
      namespace: chart.namespace,
      name: policyName,
    },
    spec: {
      name: policyName,
      statement,
      tenantRef: {
        name: "minio-tenant",
        namespace: "minio",
      },
      version: "2012-10-17",
    },
  });

  return policy;
};
