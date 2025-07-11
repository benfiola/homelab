import { Chart, Helm } from "cdk8s";
import { Namespace } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { codeblock } from "../utils/codeblock";
import {
  createNetworkPolicy,
  createTargets,
} from "../utils/createNetworkPolicy";
import { getPodRequests } from "../utils/getPodRequests";

const helmData = {
  chart: "alloy",
  version: "1.1.1",
  repo: "https://grafana.github.io/helm-charts",
};

const namespace = "alloy";

const policyTargets = createTargets((b) => ({
  collector: b.pod(namespace, "alloy"),
}));

const manifests: ManifestsCallback = async (app) => {
  const { policyTargets: kubeTargets } = await import("./k8s");
  const { policyTargets: lokiTargets } = await import("./loki");

  const chart = new Chart(app, "chart", { namespace });

  createNetworkPolicy(chart, (b) => {
    const kt = kubeTargets;
    const lt = lokiTargets;
    const pt = policyTargets;

    b.rule(pt.collector, kt.apiServer, "api");
    b.rule(pt.collector, lt.gateway, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...helmData,
    namespace: chart.namespace,
    values: {
      alloy: {
        configMap: {
          content: codeblock`
            discovery.kubernetes "pod" {
              role = "pod"
            }
            
            discovery.relabel "pod_logs" {
              targets = discovery.kubernetes.pod.targets

              rule {
                source_labels = ["__meta_kubernetes_namespace"]
                action = "replace"
                target_label = "namespace"
              }

              rule {
                source_labels = ["__meta_kubernetes_pod_name"]
                action = "replace"
                target_label = "pod"
              }

              rule {
                source_labels = ["__meta_kubernetes_pod_container_name"]
                action = "replace"
                target_label = "container"
              }

              rule {
                source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_name", "__meta_kubernetes_pod_label_app_kubernetes_io_component"]
                separator = "/"
                regex = "^piraeus-datastore\\\\/(\\\\S+)$"
                action = "replace"
                target_label = "job"
              }

              rule {
                source_labels = ["__meta_kubernetes_pod_label_bfiola_dev_pod_name"]
                regex = "^(\\\\S+)$"
                action = "replace"
                target_label = "job"
              }
            }

            loki.source.kubernetes "pod_logs" {
              targets    = discovery.relabel.pod_logs.output
              forward_to = [loki.process.pod_logs.receiver]
            }

            loki.process "pod_logs" {
              forward_to = [loki.write.default.receiver]
            }

            loki.write "default" {
              endpoint {
                url = "http://loki-gateway.loki.svc/loki/api/v1/push"
              }
            }`,
        },
        // disable reporting
        enableReporting: false,
        // set resource limits for workload
        resources: getPodRequests({ mem: 300 }),
      },
      crds: {
        // do NOT create monitoring crds
        create: false,
      },
      // give helm release a more concise name
      fullnameOverride: "alloy",
    },
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
