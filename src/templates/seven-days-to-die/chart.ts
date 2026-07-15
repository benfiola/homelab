import { Chart, Namespace, StatefulSet, TcpRoute, UdpRoute } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, id) => {
  const chart = new Chart(construct, id, { namespace: id });
  new Namespace(chart);

  const ss = new StatefulSet(chart, "seven-days-to-die", {
    securityContext: { uid: 1000, gid: 1000 },
    nodeSelector: { "kubernetes.io/arch": "amd64" },
    volumes: {
      cache: {
        pvc: { size: "30Gi", storageClass: "replicated" },
      },
    },
  });
  ss.addContainer(
    "seven-days-to-die",
    "ghcr.io/benfiola/homelab-images/seven-days-to-die:1.0.5",
    {
      containerPorts: {
        tcp: 26900,
        udp1: [26900, "UDP"],
        udp2: [26901, "UDP"],
        udp3: [26902, "UDP"],
      },
      env: { LOG_LEVEL: "debug" },
      volumeMounts: {
        cache: "/cache",
      },
    },
  );

  const svc = ss.createService({
    tcp: 26900,
    udp1: [26900, "UDP"],
    udp2: [26901, "UDP"],
    udp3: [26902, "UDP"],
  });

  new TcpRoute(chart, "friends", "sdtd.bulia.dev", 26900, svc, 26900);
  new UdpRoute(chart, "friends", "sdtd.bulia.dev", 26900, svc, 26900);
  new UdpRoute(chart, "friends", "sdtd.bulia.dev", 26901, svc, 26901);
  new UdpRoute(chart, "friends", "sdtd.bulia.dev", 26902, svc, 26902);

  return chart;
};
