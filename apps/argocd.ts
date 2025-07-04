import { Chart, Helm } from "cdk8s";
import { Command } from "commander";
import { writeFile } from "fs/promises";
import { dump as yamlDump } from "js-yaml";
import { Namespace } from "../resources/k8s/k8s";
import {
  BootstrapCallback,
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { codeblock } from "../utils/codeblock";
import {
  createNetworkPolicy,
  createTargets,
} from "../utils/createNetworkPolicy";
import { exec } from "../utils/exec";
import { getCertIssuerAnnotations } from "../utils/getCertIssuerAnnotation";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { getIngressClassName } from "../utils/getIngressClassName";
import { getPodRequests } from "../utils/getPodRequests";
import { parseEnv } from "../utils/parseEnv";

const helmData = {
  chart: "argo-cd",
  repo: "https://argoproj.github.io/argo-helm",
  version: "8.1.1",
};

const baseValues = {
  applicationSet: {
    // value recommended by argocd ha instructions
    replicas: 2,
  },
  certificate: {
    // disable tls
    enabled: false,
  },
  configs: {
    cm: {
      // define status processing for argocd application resources
      // NOTE: https://argo-cd.readthedocs.io/en/stable/operator-manual/health/#argocd-app
      "resource.customizations.useOpenLibs.argoproj.io_Application": true,
      "resource.customizations.health.argoproj.io_Application": codeblock`
          hs = {}
          hs.status = "Progressing"
          hs.message = ""
          if obj.status ~= nil then
            if obj.status.health ~= nil then
              hs.status = obj.status.health.status
              if obj.status.health.message ~= nil then
                hs.message = obj.status.health.message
              end
            end
          end
          return hs
      `,
      // ignore manual volsync triggers (manually editing the trigger will result in an argocd self-heal)
      "resource.customizations.ignoreDifferences.volsync.backube_ReplicationSource": codeblock`
          jqPathExpressions:
          - '.spec.trigger.manual'
          - '.spec.trigger.unlock'
      `,
      // exclude cilium identity resources (as they cause argocd to be out of sync)
      "resource.exclusions": yamlDump([
        {
          apiGroups: ["cilium.io"],
          kinds: ["CiliumIdentity"],
          clusters: ["*"],
        },
      ]),
      // refresh every 10 seconds
      "timeout.reconciliation": "10s",
    },
    params: {
      // disable tls
      "server.insecure": true,
    },
  },
  controller: {
    // value recommended by argocd ha instructions
    replicas: 1,
    // constrain all resources for controller workloads
    resources: getPodRequests({ cpu: 750, mem: 2000 }),
  },
  // give all resources a static prefix
  fullnameOverride: "argocd",
  "redis-ha": {
    // enables the redis ha subchart
    enabled: true,
    // give all redis ha resources a static prefix
    fullnameOverride: "redis-ha",
  },
  repoServer: {
    // value recommended by argocd ha instructions
    replicas: 2,
    // increase requests for repo-server workloads
    resources: getPodRequests({ cpu: 200, mem: 300 }),
  },
  server: {
    // value recommended by argocd ha instructions
    replicas: 2,
    // constrain all resources for server workloads
    resources: getPodRequests({ mem: 300 }),
  },
};

const namespace = "argocd";

const policyTargets = createTargets((b) => ({
  applicationController: b.pod(namespace, "argocd-application-controller"),
  applicationSetController: b.pod(
    namespace,
    "argocd-applicationset-controller"
  ),
  dexServer: b.pod(namespace, "argocd-dex-server"),
  notificationsController: b.pod(namespace, "argocd-notifications-controller"),
  redisHaproxy: b.pod(namespace, "redis-ha-haproxy", { db: [6379, "tcp"] }),
  redisSecretInit: b.pod(namespace, "argocd-redis-secret-init"),
  redisServer: b.pod(namespace, "redis-ha-server", {
    db: [6379, "tcp"],
    sentinel: [26379, "tcp"],
  }),
  repoServer: b.pod(namespace, "argocd-repo-server", { api: [8081, "tcp"] }),
  server: b.pod(namespace, "argocd-server", { api: [8080, "tcp"] }),
}));

const bootstrap: BootstrapCallback = async (app) => {
  const chart = new Chart(app, "argocd", { namespace });

  new Namespace(chart, "namespace", {
    metadata: { name: chart.namespace },
  });

  new Helm(chart, "helm", {
    ...helmData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      ...baseValues,
    },
  });

  return chart;
};

const manifests: ManifestsCallback = async (app) => {
  const { policyTargets: kubeTargets } = await import("./k8s");

  const chart = new Chart(app, "argocd", { namespace });

  createNetworkPolicy(chart, (b) => {
    const kt = kubeTargets;
    const pt = policyTargets;
    const github = b.target({
      dns: "github.com",
      ports: { api: [443, "tcp"] },
    });
    const ingress = b.target({ entity: "ingress" });

    b.rule(ingress, pt.server, "api");
    b.rule(pt.applicationController, pt.redisHaproxy, "db");
    b.rule(pt.applicationController, pt.repoServer, "api");
    b.rule(pt.applicationController, kt.apiServer, "api");
    b.rule(pt.applicationSetController, kt.apiServer, "api");
    b.rule(pt.dexServer, kt.apiServer, "api");
    b.rule(pt.notificationsController, pt.repoServer, "api");
    b.rule(pt.notificationsController, kt.apiServer, "api");
    b.rule(pt.redisHaproxy, pt.redisServer, "db", "sentinel");
    b.rule(pt.redisSecretInit, kt.apiServer, "api");
    b.rule(pt.redisServer, pt.redisServer, "db", "sentinel");
    b.rule(pt.repoServer, github, "api");
    b.rule(pt.repoServer, pt.redisHaproxy, "db");
    b.rule(pt.server, pt.redisHaproxy, "db");
    b.rule(pt.server, pt.repoServer, "api");
    b.rule(pt.server, kt.apiServer, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...helmData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      ...baseValues,
      global: {
        // define the ingress hostname for the workload
        domain: "argocd.bulia.dev",
      },
      server: {
        ...baseValues.server,
        ingress: {
          // use cluster cert-issuer
          annotations: getCertIssuerAnnotations(),
          // enable ingress generation
          enabled: true,
          // ensure ingress class utilizes the installed ingress controller
          ingressClassName: getIngressClassName(),
          // enable tls
          tls: true,
        },
      },
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  const manifest = await exec(getHelmTemplateCommand(helmData));
  await writeFile(manifestFile, manifest);
};

const setAdminPassword = async () => {
  const env = parseEnv((zod) => ({
    ARGOCD_PASSWORD: zod.string(),
  }));

  const encryptedPw = (
    await exec([
      "argocd",
      "account",
      "bcrypt",
      "--password",
      env.ARGOCD_PASSWORD,
    ])
  ).trim();
  const date = (await exec(["date", "+%FT%T%Z"])).trim();
  const patchData = {
    stringData: {
      "admin.password": encryptedPw,
      "admin.passwordMtime": date,
    },
  };
  await exec([
    "kubectl",
    "-n",
    namespace,
    "patch",
    "secret",
    "argocd-secret",
    "-p",
    JSON.stringify(patchData),
  ]);
};

export default async function (context: CliContext) {
  context.bootstrap(bootstrap);
  context.command((program: Command) => {
    program
      .command("set-admin-password")
      .description("set the admin password")
      .action(setAdminPassword);
  });
  context.manifests(manifests);
  context.resources(resources);
}
