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

  const daemonSetInit = new DaemonSet(chart, "mdns-interface-init", {
    podAnnotations: {
      "k8s.v1.cni.cncf.io/networks": "multus-network/mdns@mdns0",
    },
  });
  daemonSetInit.addContainer("mdns-interface-init", alpineImage, {
    args: ["sleep", "infinity"],
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
