import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import { Namespace } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import {
  createNetworkPolicy,
  createTargets,
} from "../utils/createNetworkPolicy";
import { createSealedSecret } from "../utils/createSealedSecret";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { parseEnv } from "../utils/parseEnv";

const helmData = {
  chart: "cert-manager",
  repo: "https://charts.jetstack.io",
  version: "v1.18.1",
};

const namespace = "cert-manager";

const policyTargets = createTargets((b) => ({
  caInjector: b.pod(namespace, "cert-manager-cainjector"),
  controller: b.pod(namespace, "cert-manager"),
  startupiApiCheck: b.pod(namespace, "cert-manager-startupapicheck"),
  webhook: b.pod(namespace, "cert-manager-webhook", { api: [10250, "tcp"] }),
}));

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    CERT_MANAGER_CLOUDFLARE_API_TOKEN: zod.string(),
  }));

  const { policyTargets: kubeTargets } = await import("./k8s");
  const { ClusterIssuer } = await import(
    "../resources/cert-manager/cert-manager.io"
  );

  const chart = new Chart(app, "cert-manager", { namespace });

  createNetworkPolicy(chart, (b) => {
    const kt = kubeTargets;
    const pt = policyTargets;
    const remoteNode = b.target({ entity: "remote-node" });

    b.rule(pt.caInjector, kt.apiServer, "api");
    b.rule(pt.controller, kt.apiServer, "api");
    b.rule(pt.startupiApiCheck, kt.apiServer, "api");
    b.rule(pt.webhook, kt.apiServer, "api");
    b.rule(remoteNode, pt.webhook, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const apiTokenSecretKey = "apiToken";
  const apiTokenSecret = await createSealedSecret(
    chart,
    "cloudflare-api-token",
    {
      metadata: {
        name: "cloudflare-api-token",
      },
      stringData: {
        [`${apiTokenSecretKey}`]: env.CERT_MANAGER_CLOUDFLARE_API_TOKEN,
      },
    }
  );

  new Helm(chart, "helm", {
    ...helmData,
    namespace: chart.namespace,
    values: {
      crds: {
        // enable crds to be generated with the chart
        enabled: true,
        // remove helm annotations to keep the crds when the release is deleted
        keep: false,
      },
      nameOverride: "cert-manager",
      // give all resources a static prefix
      fullnameOverride: "cert-manager",
    },
  });

  new ClusterIssuer(chart, "self-signed-issuer", {
    metadata: {
      name: "root",
    },
    spec: {
      selfSigned: {},
    },
  });

  new ClusterIssuer(chart, "cloudflare-issuer", {
    metadata: {
      name: "cloudflare",
    },
    spec: {
      acme: {
        email: "benfiola@gmail.com",
        privateKeySecretRef: {
          name: "acme-identity",
        },
        server: "https://acme-staging-v02.api.letsencrypt.org/directory",
        solvers: [
          {
            dns01: {
              cloudflare: {
                apiTokenSecretRef: {
                  name: apiTokenSecret.metadata.name!,
                  key: apiTokenSecretKey,
                },
              },
            },
          },
        ],
      },
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (path) => {
  const manifest = await exec([
    ...getHelmTemplateCommand(helmData),
    "--set",
    "crds.enabled=true",
  ]);
  await writeFile(path, manifest);
};

export default function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
