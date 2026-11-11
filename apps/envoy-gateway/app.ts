import type { AppFunction } from "../../tools/lib/app.ts";
import { dashboard } from "../../tools/lib/k8s/monitoring.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm("oci://docker.io/envoyproxy/gateway-crds-helm?version=1.10.0", {
    release: "envoy-gateway",
    values: { crds: { envoyGateway: { enabled: true } } },
  });

  const chart = await ns.helm(
    "oci://docker.io/envoyproxy/gateway-helm?version=1.10.0",
    {
      release: "envoy-gateway",
      values: {
        certgen: {
          job: {
            pod: { labels: { "app.kubernetes.io/component": "certgen" } },
            ttlSecondsAfterFinished: null,
          },
        },
        deployment: {
          envoyGateway: {
            resources: {
              requests: { cpu: "100m", memory: "256Mi" },
              limits: null,
            },
          },
          pod: { labels: { "app.kubernetes.io/component": "controller" } },
        },
      },
      crds: false,
    },
  );

  chart.find("Service", "envoy-gateway").serviceMonitor("metrics");

  ns.podMonitor(
    "envoy-gateway-proxy",
    {
      "app.kubernetes.io/component": "proxy",
      "app.kubernetes.io/name": "envoy",
    },
    "metrics",
    {
      path: "/stats/prometheus",
      dropMetrics: "envoy_cluster_total_match_count",
    },
  );

  await ns.helm(
    "oci://docker.io/envoyproxy/gateway-addons-helm?version=1.10.0",
    {
      release: "envoy-gateway-addons",
      values: {
        alloy: { enabled: false },
        dashboard: {
          annotations: { grafana_folder: h.app },
          labels: { grafana_dashboard: "1" },
        },
        "fluent-bit": { enabled: false },
        grafana: { enabled: false },
        loki: { enabled: false },
        "opentelemetry-collector": { enabled: false },
        prometheus: { enabled: false },
        tempo: { enabled: false },
      },
    },
  );

  h.postRender((e) => {
    dashboard(e, "grafana-dashboards", (d) =>
      d
        .replace('"uid": "PBFA97CFB590B2093"', '"uid": "$datasource"')
        .replace("envoy-gateway-system", h.app),
    );
  });

  ns.vpa({ kind: "Deployment", name: "envoy-gateway" }, { advisory: true });
};

export const network: NetworkFunction = (n) => {
  const envoyGatewayCertgen = n.subject(
    "envoy-gateway-certgen",
    component("certgen", "envoy-gateway"),
  );
  const envoyGatewayController = n.subject(
    "envoy-gateway-controller",
    component("controller", "envoy-gateway"),
  );
  const envoyGatewayProxy = n.subject(
    "envoy-gateway-proxy",
    component("proxy", "envoy-gateway"),
  );

  envoyGatewayCertgen.to(n.kubeApiServer, tcp(6443));

  envoyGatewayController.to(n.kubeApiServer, tcp(6443));
  n.controlPlane.to(envoyGatewayController, tcp(9443));
  n.host.to(envoyGatewayController, tcp(8081));
  n.ref("gateway-family").to(envoyGatewayController, tcp(18000));
  n.ref("gateway-friends").to(envoyGatewayController, tcp(18000));
  n.ref("gateway-infrastructure").to(envoyGatewayController, tcp(18000));
  n.ref("gateway-personal").to(envoyGatewayController, tcp(18000));
  n.ref("prometheus").to(envoyGatewayController, tcp(19001));

  n.host.to(envoyGatewayProxy, tcp(19002, 19003));
  n.ref("prometheus").to(envoyGatewayProxy, tcp(19001));
};
