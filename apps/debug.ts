import { Chart } from "cdk8s";
import { Namespace } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { createServiceAccount } from "../utils/createServiceAccount";

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "debug", {
    namespace: "debug",
  });

  createNetworkPolicy(chart, []);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const serviceAccount = createServiceAccount(chart, {
    access: {},
    name: "debug",
    namespace: chart.namespace,
  });

  await createDeployment(chart, {
    containers: [
      {
        image: "travelping/nettools",
        name: "debug",
        args: ["/bin/bash", "-c", "while true; do sleep 1; done;"],
      },
    ],
    name: "debug",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
