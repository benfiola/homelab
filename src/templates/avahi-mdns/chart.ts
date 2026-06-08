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

  const daemonSet = new DaemonSet(chart, "avahi", {
    hostNetwork: true,
  });
  daemonSet.addContainer("avahi", "docker.io/yuxzhu/mdns-reflector:latest", {
    args: ["sleep", "infinity"],
  });

  new VerticalPodAutoscaler(chart, daemonSet);

  return chart;
};
