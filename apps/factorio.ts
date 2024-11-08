import { Chart } from "cdk8s";
import { Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { createServiceAccount } from "../utils/createServiceAccount";
import { getDnsAnnotation } from "../utils/getDnsLabel";
import { getPodLabels } from "../utils/getPodLabels";

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "factorio", {
    namespace: "factorio",
  });

  createNetworkPolicy(chart, [
    {
      from: { pod: "factorio" },
      to: {
        dns: "*.factorio.com",
        ports: [
          [443, "tcp"],
          [34197, "udp"],
        ],
      },
    },

    {
      from: { homeNetwork: null },
      to: {
        pod: "factorio",
        ports: [
          [27015, "tcp"],
          [34197, "udp"],
        ],
      },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const serviceAccount = createServiceAccount(chart, {
    access: {},
    name: "factorio",
    namespace: chart.namespace,
  });

  const deployment = await createDeployment(chart, {
    containers: [
      {
        image: "factoriotools/factorio",
        name: "factorio",
        ports: { tcp: [27015, "tcp"], udp: [34197, "udp"] },
        resources: {
          mem: 1000,
        },
        user: 845,
      },
    ],
    name: "factorio",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
    updateStrategy: "Recreate",
  });

  new Service(chart, "factorio-service", {
    metadata: {
      namespace: chart.namespace,
      name: "factorio",
      annotations: getDnsAnnotation("factorio.bulia"),
    },
    spec: {
      type: "LoadBalancer",
      ports: [
        { name: "tcp", port: 27015 },
        { name: "udp", port: 34197 },
      ],
      selector: getPodLabels(deployment.name),
    },
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
