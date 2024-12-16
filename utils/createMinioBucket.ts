import { Chart } from "cdk8s";
import { MinioBucket } from "../resources/minio/bfiola.dev";

/**
 * Helper method that creates a minio bucket
 */
export const createMinioBucket = (chart: Chart, name: string) => {
  const bucket = new MinioBucket(chart, `minio-bucket-${name}`, {
    metadata: {
      namespace: chart.namespace,
      name: name,
    },
    spec: {
      deletionPolicy: "IfEmpty",
      name: name,
      tenantRef: {
        name: "minio-tenant",
        namespace: "minio",
      },
    },
  });

  return bucket;
};
