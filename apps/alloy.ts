import { Chart, Helm } from "cdk8s";
import { Namespace } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { codeblock } from "../utils/codeblock";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";

const appData = {
  chart: "alloy",
  version: "0.10.1",
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
                source_labels = ["__meta_kubernetes_namespace", "__meta_kubernetes_pod_container_name"]
                action = "replace"
                target_label = "job"
                separator = "/"
                replacement = "$1"
              }

              rule {
                source_labels = ["__meta_kubernetes_pod_uid", "__meta_kubernetes_pod_container_name"]
                action = "replace"
                target_label = "__path__"
                separator = "/"
                replacement = "/var/log/pods/*$1/*.log"
              }

              rule {
                source_labels = ["__meta_kubernetes_pod_container_id"]
                action = "replace"
                target_label = "container_runtime"
                regex = "^(\\\\S+):\\\\/\\\\/.+$"
                replacement = "$1"
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
