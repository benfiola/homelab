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
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { getIngressClassName } from "../utils/getIngressClassName";
import { getPodRequests } from "../utils/getPodRequests";
import { parseEnv } from "../utils/parseEnv";

const appData = {
  chart: "argo-cd",
  repo: "https://argoproj.github.io/argo-helm",
  version: "6.9.3",
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
    resources: getPodRequests({ cpu: 500, mem: 1500 }),
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
    resources: getPodRequests({ cpu: 200, mem: 200 }),
  },
  server: {
    // value recommended by argocd ha instructions
    replicas: 2,
    // constrain all resources for server workloads
    resources: getPodRequests({ mem: 300 }),
  },
};

const bootstrap: BootstrapCallback = async (app) => {
  const chart = new Chart(app, "argocd", { namespace: "argocd" });

  new Namespace(chart, "namespace", {
    metadata: { name: chart.namespace },
  });

  new Helm(chart, "helm", {
    ...appData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      ...baseValues,
    },
  });

  return chart;
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "argocd", { namespace: "argocd" });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "argocd-repo-server" },
      to: { dns: "github.com", ports: [[443, "tcp"]] },
    },

    {
      from: { pod: "argocd-application-controller" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "argocd-applicationset-controller" },
      to: {
        entity: "kube-apiserver",
        ports: [[6443, "tcp"]],
      },
    },
    {
      from: { pod: "argocd-dex-server" },
      to: {
        entity: "kube-apiserver",
        ports: [[6443, "tcp"]],
      },
    },
    {
      from: { pod: "argocd-notifications-controller" },
      to: {
        entity: "kube-apiserver",
        ports: [[6443, "tcp"]],
      },
    },
    {
      from: { pod: "argocd-server" },
      to: {
        entity: "kube-apiserver",
        ports: [[6443, "tcp"]],
      },
    },

    {
      from: { pod: "argocd-application-controller" },
      to: { pod: "argocd-repo-server", ports: [[8081, "tcp"]] },
    },
    {
      from: { pod: "argocd-notifications-controller" },
      to: { pod: "argocd-repo-server", ports: [[8081, "tcp"]] },
    },
    {
      from: { pod: "argocd-server" },
      to: { pod: "argocd-repo-server", ports: [[8081, "tcp"]] },
    },
    {
      from: { entity: "ingress" },
      to: { pod: "argocd-server", ports: [[8080, "tcp"]] },
    },
    {
      from: { pod: "argocd-application-controller" },
      to: { pod: "redis-ha-haproxy", ports: [[6379, "tcp"]] },
    },
    {
      from: { pod: "argocd-repo-server" },
      to: { pod: "redis-ha-haproxy", ports: [[6379, "tcp"]] },
    },
    {
      from: { pod: "argocd-server" },
      to: { pod: "redis-ha-haproxy", ports: [[6379, "tcp"]] },
    },
    {
      from: { pod: "redis-ha-server" },
      to: {
        pod: "redis-ha-server",
        ports: [
          [6379, "tcp"],
          [26379, "tcp"],
        ],
      },
    },
    {
      from: { pod: "redis-ha-haproxy" },
      to: {
        pod: "redis-ha-server",
        ports: [
          [6379, "tcp"],
          [26379, "tcp"],
        ],
      },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...appData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      ...baseValues,
      global: {
        // define the ingress hostname for the workload
        domain: "argocd.bulia",
      },
      server: {
        ...baseValues.server,
        ingress: {
          // enable ingress generation
          enabled: true,
          // ensure ingress class utilizes the installed ingress controller
          ingressClassName: getIngressClassName(),
          // disable tls
          tls: false,
        },
      },
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  const manifest = await exec(getHelmTemplateCommand(appData));
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
    "argocd",
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
