import { Chart } from "cdk8s";
import { MinioUser } from "../resources/minio/bfiola.dev";
import { createSealedSecret } from "./createSealedSecret";

/**
 * Helper method that creates a minio user.
 */
export const createMinioUser = async (
  chart: Chart,
  accessKey: string,
  secretKey: string
) => {
  const secret = await createSealedSecret(
    chart,
    `sealed-secret-minio-user-${accessKey}`,
    {
      metadata: {
        namespace: chart.namespace,
        name: `${accessKey}-minio-secret-key`,
      },
      stringData: {
        secretKey: secretKey,
      },
    }
  );

  const user = new MinioUser(chart, `minio-user-${accessKey}`, {
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
      tenantRef: {
        name: "minio-tenant",
        namespace: "minio",
      },
    },
  });

  return user;
};
