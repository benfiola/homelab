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
    securityContext: {
      uid: 0,
      gid: 0,
      caps: ["NET_ADMIN", "CHOWN", "FOWNER", "SYS_CHROOT", "SETUID", "SETGID"],
    },
  });
  daemonSet.addContainer("avahi", "docker.io/ydkn/avahi:371", {
    env: {
      ENABLE_REFLECTOR: "yes",
      DENY_INTERFACES: "lo,cilium_net,cilium_host,geneve_sys_6081,lxc_health",
    },
  });

  new VerticalPodAutoscaler(chart, daemonSet);

  return chart;
};
