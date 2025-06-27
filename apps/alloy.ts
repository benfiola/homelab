import { Chart, Helm } from "cdk8s";
import { Namespace } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { codeblock } from "../utils/codeblock";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { getPodRequests } from "../utils/getPodRequests";

const appData = {
  chart: "alloy",
  version: "1.1.1",
  repo: "https://grafana.github.io/helm-charts",
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "alloy", {
    namespace: "alloy",
  });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "alloy" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },

    {
      from: { pod: "alloy" },
      to: { externalPod: ["loki", "loki-gateway"], ports: [[8080, "tcp"]] },
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
