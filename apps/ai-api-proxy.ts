import { Chart } from "cdk8s";
import { ConfigMap, Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createIngress } from "../utils/createIngress";
import {
  createNetworkPolicy,
  createTargets,
} from "../utils/createNetworkPolicy";
import { createServiceAccount } from "../utils/createServiceAccount";
import { getDnsAnnotation } from "../utils/getDnsLabel";
import { getPodLabels } from "../utils/getPodLabels";
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";
import { parseEnv } from "../utils/parseEnv";

const appData = {
  frpVersion: "0.63.0",
  wolProxyVersion: "1.0.0",
};

const namespace = "ai-api-proxy";

const policyTargets = createTargets((b) => ({
  proxy: b.pod(namespace, "proxy", {
    api: [8081, 8082, "tcp"],
  }),
  tunnel: b.pod(namespace, "tunnel", {
    server: [8080, "tcp"],
    client: [8081, 8082, "tcp"],
  }),
}));

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((z) => ({}));

  const chart = new Chart(app, "chart", { namespace });

  createNetworkPolicy(chart, (b) => {
    const pt = policyTargets;
    const desktop = b.target({
      dns: "bfiola-desktop.bulia.dev",
      ports: { wol: [9, "udp"], tools: [8081, 8083, "tcp"] },
    });
    const homeNetwork = b.target({
      cidr: "192.168.0.0/16",
    });
    const ingress = b.target({
      entity: "ingress",
      ports: { clients: [1, 65535, "tcp"] },
    });

    b.rule(homeNetwork, pt.tunnel, "server");
    b.rule(ingress, pt.proxy, "api");
    b.rule(pt.proxy, desktop, "wol");
    b.rule(pt.proxy, pt.tunnel, "client");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
      labels: getPrivilegedNamespaceLabels(),
    },
  });

  const tunnelSa = createServiceAccount(chart, "tunnel-sa", {
    access: {},
    name: "tunnel",
  });

  const tunnelConfig = new ConfigMap(chart, "tunnel-cm", {
    metadata: { name: "tunnel" },
    data: {
      "config.json": JSON.stringify(
        {
          bindPort: 8080,
        },
        null,
        2
      ),
    },
  });

  const tunnelDeployment = createDeployment(chart, "tunnel-deployment", {
    containers: [
      {
        name: "frp",
        image: `fatedier/frps:v${appData.frpVersion}`,
        args: ["--config", "/config/config.json"],
        ports: {
          server: [8080, "tcp"],
          text: [8081, "tcp"],
          img: [8082, "tcp"],
        },
        mounts: {
          config: "/config",
        },
      },
    ],
    name: "tunnel",
    serviceAccount: tunnelSa.name,
    volumes: {
      config: tunnelConfig,
    },
  });

  const tunnelClientService = new Service(chart, "tunnel-client-service", {
    metadata: { name: "tunnel-client" },
    spec: {
      ports: [
        {
          targetPort: { value: "text" },
          port: 8081,
          name: "text",
        },
        {
          targetPort: { value: "img" },
          port: 8082,
          name: "img",
        },
      ],
      selector: getPodLabels(tunnelDeployment.name),
    },
  });

  new Service(chart, "tunnel-server-service", {
    metadata: {
      name: "tunnel-server",
      annotations: getDnsAnnotation("tunnel.ai.bulia.dev"),
    },
    spec: {
      ports: [
        {
          targetPort: { value: 8080 },
          port: 80,
          name: "server",
        },
      ],
      selector: getPodLabels(tunnelDeployment.name),
      type: "LoadBalancer",
    },
  });

  const proxySa = createServiceAccount(chart, "proxy-sa", {
    access: {},
    name: "proxy",
  });

  const proxyDeployment = createDeployment(chart, "proxy-deployment", {
    containers: [
      {
        name: "wol-proxy-txt",
        image: `benfiola/homelab-wol-proxy:${appData.wolProxyVersion}`,
        env: {
          WOLPROXY_ADDRESS: "0.0.0.0:8081",
          WOLPROXY_BACKEND: `${tunnelClientService.name}.${namespace}.svc:8081`,
          WOLPROXY_WOL_HOSTNAME: "bfiola-desktop.bulia.dev",
          WOLPROXY_WOL_MAC_ADDRESS: "C8:7F:54:6C:10:46",
        },
        ports: {
          text: [8081, "tcp"],
        },
      },
      {
        name: "wol-proxy-img",
        image: `benfiola/homelab-wol-proxy:${appData.wolProxyVersion}`,
        env: {
          WOLPROXY_ADDRESS: "0.0.0.0:8082",
          WOLPROXY_BACKEND: `${tunnelClientService.name}.${namespace}.svc:8082`,
          WOLPROXY_WOL_HOSTNAME: "bfiola-desktop.bulia.dev",
          WOLPROXY_WOL_MAC_ADDRESS: "C8:7F:54:6C:10:46",
        },
        ports: {
          img: [8082, "tcp"],
        },
      },
    ],
    name: "proxy",
    serviceAccount: proxySa.name,
  });

  const proxyService = new Service(chart, "proxy-service", {
    metadata: { name: "proxy" },
    spec: {
      ports: [
        {
          targetPort: { value: "text" },
          port: 8081,
          name: "text",
        },
        {
          targetPort: { value: "img" },
          port: 8082,
          name: "img",
        },
      ],
      selector: getPodLabels(proxyDeployment.name),
    },
  });

  createIngress(chart, "txt-api-ingress", {
    name: "txt-api",
    host: "txt.ai.bulia.dev",
    services: { "/": { name: proxyService.name, port: "text" } },
  });

  createIngress(chart, "img-api-ingress", {
    name: "img-api",
    host: "img.ai.bulia.dev",
    services: { "/": { name: proxyService.name, port: "img" } },
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
