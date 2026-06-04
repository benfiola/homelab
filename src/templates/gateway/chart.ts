import { GatewayClass } from "../../../assets/gateway-api/gateway.networking.k8s.io";
import { WrappedGateway } from "../../../assets/gateway-route-sync/gateway-route-sync.homelab-helper.benfiola.com";
import { Chart, gateways, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart);

  const gatewayClass = new GatewayClass(chart, `${id}-gateway-class`, {
    metadata: {
      name: "default",
    },
    spec: {
      controllerName: "gateway.envoyproxy.io/gatewayclass-controller",
    },
  });

  const staticIps: Record<(typeof gateways)[number], string> = {
    users: "192.168.33.2",
    personal: "192.168.33.3",
    infrastructure: "192.168.33.4",
    public: "192.168.33.5",
    iot: "192.168.33.6",
  };

  for (const name of gateways) {
    const annotations: Record<string, string> = {
      "cert-manager.io/cluster-issuer": "cloudflare",
    };
    if (name === "public") {
      annotations["external-dns.alpha.kubernetes.io/target"] =
        "current.fiola.dev";
    }
    const staticIp = staticIps[name];
    new WrappedGateway(chart, `${id}-wrapped-gateway-${name}`, {
      metadata: {
        annotations,
        name,
      },
      spec: {
        gatewayClassName: gatewayClass.name,
        infrastructure: {
          annotations: {
            "lbipam.cilium.io/ips": staticIp,
          },
        },
      },
    });
  }

  return chart;
};
