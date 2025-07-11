import { Chart } from "cdk8s";
import { Namespace } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import {
  createNetworkPolicy,
  createTargets,
} from "../utils/createNetworkPolicy";
import { createSealedSecret } from "../utils/createSealedSecret";
import { createServiceAccount } from "../utils/createServiceAccount";
import { parseEnv } from "../utils/parseEnv";

const appData = {
  version: "0.18.0",
  webhookVersion: "2.0.1",
};

const namespace = "external-dns";

const policyTargets = createTargets((b) => ({
  controller: b.pod(namespace, "external-dns"),
}));

const manifests: ManifestsCallback = async (app) => {
  const { policyTargets: kubeTargets } = await import("./k8s");

  const env = parseEnv((zod) => ({
    EXTERNAL_DNS_ROUTEROS_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "chart", { namespace });

  createNetworkPolicy(chart, (b) => {
    const kt = kubeTargets;
    const pt = policyTargets;
    const router = b.target({
      dns: "router.bulia.dev",
      ports: { api: [8728, "tcp"] },
    });

    b.rule(pt.controller, router, "api");
    b.rule(pt.controller, kt.apiServer, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const serviceAccount = createServiceAccount(chart, "service-account", {
    name: "external-dns",
    access: {
      nodes: ["watch", "list"],
      pods: ["get", "watch", "list"],
      services: ["get", "watch", "list"],
      "discovery.k8s.io/endpointslices": ["get", "watch", "list"],
      "extensions/ingresses": ["get", "watch", "list"],
      "networking.k8s.io/ingresses": ["get", "watch", "list"],
    },
  });

  const secret = await createSealedSecret(chart, "sealed-secret", {
    metadata: {
      namespace: chart.namespace,
      name: "webhook",
    },
    stringData: {
      EXTERNAL_DNS_ROUTEROS_PROVIDER_LOG_LEVEL: "debug",
      EXTERNAL_DNS_ROUTEROS_PROVIDER_ROUTEROS_ADDRESS: "router.bulia.dev:8728",
      EXTERNAL_DNS_ROUTEROS_PROVIDER_ROUTEROS_PASSWORD:
        env.EXTERNAL_DNS_ROUTEROS_PASSWORD,
      EXTERNAL_DNS_ROUTEROS_PROVIDER_ROUTEROS_USERNAME: "external-dns",
      EXTERNAL_DNS_ROUTEROS_PROVIDER_SERVER_HOST: "0.0.0.0",
    },
  });

  createDeployment(chart, "deployment", {
    containers: [
      {
        args: ["run"],
        envFrom: [secret],
        image: `docker.io/benfiola/external-dns-routeros-provider:${appData.webhookVersion}`,
        name: "webhook",
        probe: ["/healthz", 8888],
      },
      {
        args: [
          "--source=service",
          "--source=ingress",
          "--provider=webhook",
          "--log-level=debug",
          "--interval=20s",
        ],
        image: `registry.k8s.io/external-dns/external-dns:v${appData.version}`,
        name: "controller",
        ports: { metrics: [7979, "tcp"] },
      },
    ],
    name: "external-dns",
    serviceAccount: serviceAccount.name,
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
