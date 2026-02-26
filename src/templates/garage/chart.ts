import {
  GarageCluster,
  GarageClusterSpecStorageDataSize as StorageSize,
} from "../../../assets/garage-operator/garage.rajsingh.info";
import { Chart, getSecurityContext, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const securityContext = getSecurityContext();

  new GarageCluster(chart, `${id}-garage-cluster`, {
    metadata: {
      name: "garage",
    },
    spec: {
      containerSecurityContext: securityContext.container,
      podLabels: {
        "app.kubernetes.io/name": "garage",
      },
      replicas: 3,
      replication: {
        factor: 2,
      },
      securityContext: securityContext.pod,
      storage: {
        data: {
          size: StorageSize.fromString("100Gi"),
          storageClassName: "standard",
        },
        metadata: {
          storageClassName: "standard",
        },
      },
    },
  });

  return chart;
};
