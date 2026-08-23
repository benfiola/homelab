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

  const daemonSet = new DaemonSet(chart, id, {
    hostNetwork: true,
    securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
  });
  daemonSet.addContainer(
    id,
    "ghcr.io/benfiola/homelab-images/mdns-reflector:3.0.1",
    {
      env: {
        EXTRA_INTERFACES: "mdns0",
      },
    },
  );

  new VerticalPodAutoscaler(chart, daemonSet);

  return chart;
};
