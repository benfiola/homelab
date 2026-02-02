import {
  Chart,
  findApiObject,
  getSecurityContext,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { textblock } from "../../strings";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const securityContext = getSecurityContext();

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    alloy: {
      configMap: {
        content: textblock`
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
            }
          `,
      },
      enableReporting: false,
      securityContext: securityContext.container,
    },
    configReloader: {
      securityContext: securityContext.container,
    },
    crds: {
      enable: false,
    },
    global: {
      podSecurityContext: securityContext.pod,
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      name: "alloy",
    }),
  );

  return chart;
};
