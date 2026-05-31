import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  getSecurityContext,
  Namespace,
  StatefulSet,
  VolsyncAuth,
  VolsyncBackup,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { textblock } from "../../strings";

export const chart: TemplateChartFn = async (construct, id: string) => {
  const chart = new Chart(construct, id);
  new Namespace(chart);

  const scripts = new ConfigMap(chart, `${id}-config-map`, {
    metadata: {
      name: "scripts",
    },
    data: {
      "run.sh": textblock`
        #!/bin/sh -e
        while true; do
          date > /data/date.txt
          sleep 30
        done
      `,
    },
  });

  const ss = new StatefulSet(chart, "testing", {
    volumes: {
      data: {
        pvc: { size: "10Gi", storageClass: "standard" },
      },
      scripts: { configMap: scripts.name },
    },
  });
  ss.addContainer("testing", "alpine:latest", {
    args: ["sh", "-e", "/scripts/run.sh"],
    volumeMounts: {
      data: "/data",
      scripts: "/scripts",
    },
  });

  const volsyncAuth = new VolsyncAuth(chart);
  new VolsyncBackup(chart, volsyncAuth, "data-testing-0", {
    securityContext: getSecurityContext().pod,
  });

  return chart;
};
