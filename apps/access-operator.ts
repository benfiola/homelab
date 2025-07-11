import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import { Namespace } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { createCloudflareTunnel } from "../utils/createCloudflareTunnel";
import {
  createNetworkPolicy,
  createTargets,
} from "../utils/createNetworkPolicy";
import { createSealedSecret } from "../utils/createSealedSecret";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { getIngressClassName } from "../utils/getIngressClassName";
import { parseEnv } from "../utils/parseEnv";

const helmData = {
  crds: {
    chart: "crds",
    repo: "https://benfiola.github.io/access-operator/charts",
    version: "0.1.2",
  },
  operator: {
    chart: "operator",
    repo: "https://benfiola.github.io/access-operator/charts",
    version: "0.1.2",
  },
};

const namespace = "access-operator";

const policyTargets = createTargets((b) => ({
  operator: b.pod(namespace, "access-operator-operator"),
  server: b.pod(namespace, "access-operator-server", { api: [8080, "tcp"] }),
  tunnel: b.pod(namespace, "access-operator-cloudflare-tunnel"),
}));

const manifests: ManifestsCallback = async (app) => {
  const { policyTargets: kubeTargets } = await import("./k8s");

  const env = parseEnv((zod) => ({
    ACCESS_OPERATOR_CLOUDFLARE_API_TOKEN: zod.string(),
    ACCESS_OPERATOR_CLOUDFLARE_TUNNEL_TOKEN: zod.string(),
    ACCESS_OPERATOR_ROUTEROS_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "chart", { namespace });

  createNetworkPolicy(chart, (b) => {
    const kt = kubeTargets;
    const pt = policyTargets;
    const akamai = b.target({
      dns: "whatismyip.akamai.com",
      ports: { api: [80, "tcp"] },
    });
    const cloudflare = b.target({
      dns: "api.cloudflare.com",
      ports: { api: [443, "tcp"] },
    });
    const ingress = b.target({ entity: "ingress" });
    const router = b.target({
      dns: "router.bulia.dev",
      ports: { api: [8728, "tcp"] },
    });
    const tunnel = b.target({
      dns: "*.*.argotunnel.com",
      ports: { tunnel: [7844, "udp"] },
    });

    b.rule(ingress, pt.server, "api");
    b.rule(pt.operator, cloudflare, "api");
    b.rule(pt.operator, akamai, "api");
    b.rule(pt.operator, router, "api");
    b.rule(pt.operator, kt.apiServer, "api");
    b.rule(pt.server, kt.apiServer, "api");
    b.rule(pt.tunnel, pt.server, "api");
    b.rule(pt.tunnel, tunnel, "tunnel");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm-crds", {
    ...helmData.crds,
    namespace: chart.namespace,
    releaseName: "access-operator-crds",
  });

  const operatorSecret = await createSealedSecret(chart, "operator-secret", {
    metadata: { namespace: chart.namespace, name: "operator" },
    stringData: {
      ACCESS_OPERATOR_CLOUDFLARE_TOKEN:
        env.ACCESS_OPERATOR_CLOUDFLARE_API_TOKEN,
      ACCESS_OPERATOR_LOG_LEVEL: "debug",
      ACCESS_OPERATOR_ROUTEROS_ADDRESS: "router.bulia.dev:8728",
      ACCESS_OPERATOR_ROUTEROS_PASSWORD: env.ACCESS_OPERATOR_ROUTEROS_PASSWORD,
      ACCESS_OPERATOR_ROUTEROS_USERNAME: "access-operator",
    },
  });

  const serverSecret = await createSealedSecret(chart, "server-secret", {
    metadata: { namespace: chart.namespace, name: "server" },
    stringData: {
      ACCESS_OPERATOR_LOG_LEVEL: "debug",
    },
  });

  new Helm(chart, "helm-operator", {
    ...helmData.operator,
    namespace: chart.namespace,
    releaseName: "access-operator",
    values: {
      operator: {
        // use external secret for configuration
        externalSecret: operatorSecret.name,
      },
      server: {
        // use external secret for configuration
        externalSecret: serverSecret.name,
        // enable ingress for server
        ingress: {
          enabled: true,
          hostname: "access.bulia.dev",
          ingressClassName: getIngressClassName(),
        },
      },
    },
  });

  await createCloudflareTunnel(chart, "cloudflare-tunnel", {
    name: "access-operator-cloudflare-tunnel",
    target: `http://access-operator-server.${chart.namespace}.svc:80`,
    tunnelToken: env.ACCESS_OPERATOR_CLOUDFLARE_TUNNEL_TOKEN,
    tunnelUuid: "6e2a4de3-4af0-45ea-825e-f7074b4a2148",
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  const manifest = await exec(getHelmTemplateCommand(helmData.crds));
  await writeFile(manifestFile, manifest);
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
