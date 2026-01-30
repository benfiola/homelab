import { GatewayClass } from "../../../assets/gateway-api/gateway.networking.k8s.io";
import {
  WrappedGatewaySpecListenerTemplateTlsMode as TlsMode,
  WrappedGateway,
} from "../../../assets/gateway-route-sync/gateway-route-sync.homelab-helper.benfiola.com";
import { Chart, gateways, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const gatewayClass = new GatewayClass(chart, `${id}-gateway-class`, {
    metadata: {
      name: "default",
    },
    spec: {
      controllerName: "gateway.envoyproxy.io/gatewayclass-controller",
    },
  });

  for (const name of gateways) {
    new WrappedGateway(chart, `${id}-wrapped-gateway-${name}`, {
      metadata: {
        annotations: {
          "cert-manager.io/cluster-issuer": "cloudflare",
        },
        name,
      },
      spec: {
        gatewayClassName: gatewayClass.name,
        listenerTemplate: {
          protocol: "HTTPS",
          port: 443,
          tls: {
            mode: TlsMode.TERMINATE,
            certificateRefs: [{ name: `${name}-\${index}-tls` }],
          },
        },
      },
    });
  }

  return chart;
};
