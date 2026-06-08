import dedent from "ts-dedent";
import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  DaemonSet,
  findApiObject,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { alpineImage } from "../../image-refs";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const scripts = new ConfigMap(chart, `${id}-config-map-scripts`, {
    metadata: {
      name: "mdns-reflector-scripts",
    },
    data: {
      "init.sh": dedent`
        #!/bin/sh
        set -e
        echo "sleeping for 5 seconds"
        sleep 5
        echo "checking for mdns0"
        ip link show mdns0
        echo "mdns0 found - waiting for termination"
        sleep infinity
      `,
    },
  });

  const daemonSetInit = new DaemonSet(chart, "mdns-interface-init", {
    volumes: {
      scripts: { configMap: scripts.name },
    },
    podAnnotations: {
      "k8s.v1.cni.cncf.io/networks": "multus-network/mdns@mdns0",
    },
  });
  daemonSetInit.addContainer("mdns-interface-init", alpineImage, {
    args: ["sh", "/scripts/init.sh"],
    volumeMounts: {
      scripts: "/scripts",
    },
  });

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    config: {
      destInterfaces: "mdns0",
    },
    daemonSet: {
      hostNetwork: true,
    },
  });

  new VerticalPodAutoscaler(chart, daemonSetInit);
  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      name: "mdns-reflector",
    }),
  );

  return chart;
};
