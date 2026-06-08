import dedent from "ts-dedent";
import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  DaemonSet,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const scripts = new ConfigMap(chart, `${id}-config-map-scripts`, {
    metadata: {
      name: "scripts",
    },
    data: {
      "run.sh": dedent`
        #!/bin/sh
        set -e
        interface="$(ip route | grep default | awk '{print $5}' | head -1)"
        if [ "\${interface}" = "" ]; then
          1>&2 echo "could not determine primary interface"
          exit 1
        fi
        mdns-reflector -f \${interface} mdns0
      `,
    },
  });

  const daemonSet = new DaemonSet(chart, "mdns-reflector", {
    hostNetwork: true,
    securityContext: { caps: ["NET_RAW"] },
    volumes: {
      scripts: { configMap: scripts.name },
      run: { emptyDir: {} },
    },
  });
  daemonSet.addContainer(
    "mdns-reflector",
    "docker.io/yuxzhu/mdns-reflector@sha256:266837dada296e012d2f622c607886ee255ccc020bc5148c524c31a6bfceaeec",
    {
      args: ["sh", "/scripts/run.sh"],
      volumeMounts: {
        scripts: "/scripts",
        run: "/var/run",
      },
    },
  );

  new VerticalPodAutoscaler(chart, daemonSet);

  return chart;
};
