import { ConfigMap, StatefulSet } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  getSecurityContext,
  Namespace,
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

  const securityContext = getSecurityContext();

  new StatefulSet(chart, `${id}-stateful-set`, {
    metadata: {
      name: "testing",
    },
    spec: {
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "volsync-testing",
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "volsync-testing",
          },
        },
        spec: {
          containers: [
            {
              name: "testing",
              image: "alpine:latest",
              args: ["sh", "-e", "/scripts/run.sh"],
              securityContext: securityContext.container,
              volumeMounts: [
                {
                  name: "data",
                  mountPath: "/data",
                },
                {
                  name: "scripts",
                  mountPath: "/scripts",
                },
              ],
            },
          ],
          securityContext: securityContext.pod,
          volumes: [
            {
              name: "data",
              persistentVolumeClaim: {
                claimName: "data",
              },
            },
            {
              name: "scripts",
              configMap: {
                name: scripts.name,
                items: [
                  {
                    key: "run.sh",
                    path: "./run.sh",
                  },
                ],
              },
            },
          ],
        },
      },
      volumeClaimTemplates: [
        {
          metadata: {
            name: "data",
          },
          spec: {
            accessModes: ["ReadWriteOnce"],
            resources: {
              requests: {
                storage: "10Gi",
              },
            },
            storageClassName: "standard",
          },
        } as any,
      ],
    },
  });

  const volsyncAuth = new VolsyncAuth(chart);
  new VolsyncBackup(chart, volsyncAuth, "data-testing-0", {
    securityContext: securityContext.pod,
  });

  return chart;
};
