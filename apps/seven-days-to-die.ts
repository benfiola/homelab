import { Chart } from "cdk8s";
import { AccessClaim } from "../resources/access-operator/bfiola.dev";
import { Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { createPersistentVolumeClaim } from "../utils/createPersistentVolumeClaim";
import { createSealedSecret } from "../utils/createSealedSecret";
import { createServiceAccount } from "../utils/createServiceAccount";
import { getDnsAnnotation } from "../utils/getDnsLabel";
import { getPodLabels } from "../utils/getPodLabels";
import { parseEnv } from "../utils/parseEnv";

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    SEVEN_DAYS_TO_DIE_ACCESS_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "seven-days-to-die", {
    namespace: "seven-days-to-die",
  });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { homeNetwork: null },
      to: {
        pod: "seven-days-to-die",
        ports: [
          [[26900, 26903], "udp"],
          [26900, "tcp"],
        ],
      },
    },

    {
      from: { pod: "seven-days-to-die" },
      to: {
        dns: "api.epicgames.dev",
        ports: [[443, "tcp"]],
      },
    },
    {
      from: { pod: "seven-days-to-die" },
      to: { dns: "*.googleapis.com", ports: [[443, "tcp"]] },
    },
    {
      from: { pod: "seven-days-to-die" },
      to: {
        dns: "api.steampowered.com",
        ports: [[443, "tcp"]],
      },
    },
    {
      from: { pod: "seven-days-to-die" },
      to: {
        dns: "test.steampowered.com",
        ports: [[80, "tcp"]],
      },
    },
    {
      from: { pod: "seven-days-to-die" },
      to: {
        dns: "*.steamserver.net",
        ports: [
          [80, "tcp"],
          [443, "tcp"],
          [[27015, 27050], "any"],
        ],
      },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const serviceAccount = createServiceAccount(chart, "service-account", {
    access: {},
    name: "seven-days-to-die",
  });

  const dataVolume = createPersistentVolumeClaim(chart, "pvc", {
    name: "seven-days-to-die-data",
    size: "30Gi",
  });

  const roots = [
    "https://storage.googleapis.com/seven-days-to-die-fqgzw2/DF-V6-DEV-B16.zip",
  ];

  const serverSecret = await createSealedSecret(chart, "secret", {
    metadata: { namespace: chart.namespace, name: "seven-days-to-die" },
    stringData: {
      ROOT_URLS: roots.join(","),
      SETTING_Region: "NorthAmericaWest",
      SETTING_ServerName: "seven-days-to-die.bfiola.dev",
      SETTING_ServerVisibility: "0",
    },
  });

  const deployment = createDeployment(chart, "deployment", {
    containers: [
      {
        envFrom: [serverSecret],
        image: "benfiola/seven-days-to-die:6852366042385286885",
        imagePullPolicy: "Always",
        mounts: {
          data: "/data",
        },
        name: "seven-days-to-die",
        ports: {
          udp1: [26900, "udp"],
          tcp: [26900, "tcp"],
          udp2: [26901, "udp"],
          udp3: [26902, "udp"],
          udp4: [26903, "udp"],
        },
        resources: {
          cpu: 2000,
          mem: 4000,
        },
      },
    ],
    name: "seven-days-to-die",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
    updateStrategy: "Recreate",
    user: 1000,
    volumes: {
      data: dataVolume,
    },
  });

  new Service(chart, "service", {
    metadata: {
      namespace: chart.namespace,
      name: "seven-days-to-die",
      annotations: getDnsAnnotation("sdtd.bulia"),
    },
    spec: {
      type: "LoadBalancer",
      ports: [
        { name: "udp1", port: 26900, protocol: "UDP" },
        { name: "tcp", port: 26900, protocol: "TCP" },
        { name: "udp2", port: 26901, protocol: "UDP" },
        { name: "udp3", port: 26902, protocol: "UDP" },
        { name: "udp4", port: 26903, protocol: "UDP" },
      ],
      selector: getPodLabels(deployment.name),
    },
  });

  const accessSecret = await createSealedSecret(chart, "access-secret", {
    metadata: { namespace: chart.namespace, name: "seven-days-to-die-access" },
    stringData: {
      password: env.SEVEN_DAYS_TO_DIE_ACCESS_PASSWORD,
    },
  });

  new AccessClaim(chart, "access", {
    metadata: {
      namespace: chart.namespace,
      name: "seven-days-to-die",
    },
    spec: {
      dns: "sdtd.bfiola.dev",
      passwordRef: {
        key: "password",
        name: accessSecret.name,
      },
      serviceTemplates: [
        {
          type: "LoadBalancer",
          ports: [
            { name: "udp1", port: 26900, protocol: "UDP" },
            { name: "tcp", port: 26900, protocol: "TCP" },
            { name: "udp2", port: 26901, protocol: "UDP" },
            { name: "udp3", port: 26902, protocol: "UDP" },
            { name: "udp4", port: 26903, protocol: "UDP" },
          ],
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
