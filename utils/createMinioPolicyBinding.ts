import { Chart } from "cdk8s";
import { MinioPolicyBinding } from "../resources/minio/bfiola.dev";

/**
 * Helper method that creates a minio policy binding
 */
export const createMinioPolicyBinding = (
  chart: Chart,
  policy: string,
  user: string
) => {
  const policyBinding = new MinioPolicyBinding(
    chart,
    `policy-binding-${policy}-${user}`,
    {
      metadata: {
        namespace: chart.namespace,
        name: policy,
      },
      spec: {
        policy: policy,
        tenantRef: {
          name: "minio-tenant",
          namespace: "minio",
        },
        user: {
          builtin: user,
        },
      },
    }
  );

  return policyBinding;
};
