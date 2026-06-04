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

  const config = new ConfigMap(chart, `${id}-config-map`, {
    metadata: { name: "avahi-config" },
    data: {
      "avahi-daemon.conf": dedent`
        [server]
        use-ipv4=yes
        use-ipv6=no
        deny-interfaces=lo,cilium_net,cilium_host,geneve_sys_6081,lxc_health
        ratelimit-interval-usec=1000000
        ratelimit-burst=1000

        [wide-area]
        enable-wide-area=no

        [publish]
        disable-publishing=yes

        [reflector]
        enable-reflector=yes
        reflect-ipv4=yes

        [rlimits]
      `,
    },
  });

  const daemonSet = new DaemonSet(chart, "avahi", {
    hostNetwork: true,
    securityContext: { uid: 0, gid: 0, caps: ["NET_ADMIN"] },
    volumes: {
      config: { configMap: config.name },
    },
  });
  daemonSet.addContainer("avahi", "ghcr.io/onedr0p/avahi:0.8", {
    volumeMounts: {
      config: "/etc/avahi",
    },
  });

  new VerticalPodAutoscaler(chart, daemonSet);

  return chart;
};
