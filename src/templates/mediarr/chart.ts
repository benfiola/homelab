import {
  PersistentVolumeClaim,
  Quantity,
} from "../../../assets/kubernetes/k8s";
import { Chart, Deployment, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, id) => {
  const chart = new Chart(construct, id);

  new Namespace(chart);

  new PersistentVolumeClaim(chart, "pvc-data", {
    metadata: {
      name: "data",
    },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: "standard",
      resources: {
        requests: {
          storage: Quantity.fromString("100Gi"),
        },
      },
    },
  });

  const timezone = "America/Los_Angeles";
  const sonarr = new Deployment(chart, "sonarr", {
    volumes: {
      data: { pvc: { name: "data" } },
      run: { emptyDir: {} },
    },
  });
  sonarr.addContainer("sonarr", "lscr.io/linuxserver/sonarr:4.0.19", {
    env: { TZ: timezone },
    volumeMounts: {
      data: "/data",
      run: "/run",
    },
  });

  return chart;
};
