import {
  PersistentVolumeClaim,
  Quantity,
} from "../../../assets/kubernetes/k8s";
import {
  Chart,
  findApiObject,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
  VolsyncAuth,
  VolsyncBackup,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart);

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    "kube-rbac-proxy-resources": {
      requests: { cpu: "5m", memory: "64Mi" },
      limits: null,
    },
    resources: {
      requests: { cpu: "100m", memory: "64Mi" },
      limits: null,
    },
  });

  const pvc = new PersistentVolumeClaim(chart, `${id}-test-pvc`, {
    metadata: {
      name: "testing",
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "standard",
      resources: {
        requests: {
          storage: Quantity.fromString("2Gi"),
        },
      },
    },
  });
  const vsAuth = new VolsyncAuth(chart);
  new VolsyncBackup(chart, vsAuth, pvc.name);

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "volsync",
    }),
  );

  return chart;
};
