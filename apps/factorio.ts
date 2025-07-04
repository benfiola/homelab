import { Chart } from "cdk8s";
import { AccessClaim } from "../resources/access-operator/bfiola.dev";
import { ConfigMap, Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import {
  createNetworkPolicy,
  createTargets,
} from "../utils/createNetworkPolicy";
import { createSealedSecret } from "../utils/createSealedSecret";
import { createServiceAccount } from "../utils/createServiceAccount";
import { createStatefulSet } from "../utils/createStatefulSet";
import { createVolumeBackupConfig } from "../utils/createVolumeBackupConfig";
import { getDnsAnnotation } from "../utils/getDnsLabel";
import { getPodLabels } from "../utils/getPodLabels";
import { parseEnv } from "../utils/parseEnv";

const namespace = "factorio";

const policyTargets = createTargets((b) => ({
  server: b.pod(namespace, "factorio", { game: [34197, "udp"] }),
}));

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    FACTORIO_ACCESS_PASSWORD: zod.string(),
    FACTORIO_TOKEN: zod.string(),
  }));

  const chart = new Chart(app, "factorio", {
    namespace,
  });

  createNetworkPolicy(chart, (b) => {
    const pt = policyTargets;
    const factorio = b.target({
      dns: "*.factorio.com",
      ports: { api: [443, "tcp"], game: [34197, "udp"] },
    });
    const homeNetwork = b.target({ cidr: "192.168.0.0/16" });

    b.rule(homeNetwork, factorio, "game");
    b.rule(pt.server, factorio, "api", "game");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const serviceAccount = createServiceAccount(chart, "service-account", {
    access: {},
    name: "factorio",
  });

  const mods = [
    {
      name: "elevated-rails",
      enabled: true,
    },
    {
      name: "quality",
      enabled: true,
    },
    {
      name: "space-age",
      enabled: true,
    },
    {
      name: "ammo-loader",
      enabled: true,
    },
    {
      name: "DiscoScience",
      enabled: true,
    },
    {
      name: "flib",
      enabled: true,
    },
    {
      name: "squeak-through-2",
      enabled: true,
    },
    {
      name: "StatsGui",
      enabled: true,
    },
  ];

  const modList = new ConfigMap(chart, "mod-list", {
    metadata: { namespace: chart.namespace, name: "factorio" },
    data: {
      "mod-list.json": JSON.stringify({ mods }),
    },
  });

  const serverSecret = await createSealedSecret(chart, "secret", {
    metadata: { namespace: chart.namespace, name: "factorio" },
    stringData: {
      UPDATE_MODS_ON_START: "true",
      USERNAME: "itsbenlol",
      TOKEN: env.FACTORIO_TOKEN,
    },
  });

  const deployment = createStatefulSet(chart, "deployment", {
    initContainers: [
      {
        image: "ubuntu:latest",
        mounts: {
          data: "/factorio",
          modlist: "/modlist",
        },
        name: "copy-mod-list",
        args: [
          "/bin/bash",
          "-ex",
          "-c",
          "mkdir -p /factorio/mods && cp /modlist/mod-list.json /factorio/mods/mod-list.json",
        ],
      },
    ],
    containers: [
      {
        envFrom: [serverSecret],
        image: "factoriotools/factorio:2.0.58",
        mounts: {
          data: "/factorio",
        },
        name: "factorio",
        ports: { udp: [34197, "udp"] },
        resources: {
          cpu: 300,
          mem: 1000,
        },
      },
    ],
    name: "factorio",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
    user: 845,
    volumes: {
      modlist: modList,
    },
    volumeClaimTemplates: {
      data: "10Gi",
    },
  });

  await createVolumeBackupConfig(chart, { pvc: "data-factorio-0", user: 845 });

  new Service(chart, "service", {
    metadata: {
      namespace: chart.namespace,
      name: "factorio",
      annotations: getDnsAnnotation("factorio.bulia.dev"),
    },
    spec: {
      type: "LoadBalancer",
      ports: [{ name: "udp", port: 34197, protocol: "UDP" }],
      selector: getPodLabels(deployment.name),
    },
  });

  const accessSecret = await createSealedSecret(chart, "access-secret", {
    metadata: { namespace: chart.namespace, name: "factorio-access" },
    stringData: {
      password: env.FACTORIO_ACCESS_PASSWORD,
    },
  });

  new AccessClaim(chart, "access", {
    metadata: {
      namespace: chart.namespace,
      name: "factorio",
    },
    spec: {
      dns: "factorio.bfiola.dev",
      passwordRef: {
        key: "password",
        name: accessSecret.name,
      },
      serviceTemplates: [
        {
          type: "LoadBalancer",
          ports: [{ name: "udp", port: 34197, protocol: "UDP" }],
          selector: getPodLabels(deployment.name),
        },
      ],
      ttl: "168h",
    },
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
