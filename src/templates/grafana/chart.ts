import { URL } from "url";
import { Grafana } from "../../../assets/grafana-operator/grafana.integreatly.org";
import {
  Chart,
  getField,
  HttpRoute,
  Namespace,
  VaultAuth,
  VaultStaticSecret,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const vaultAuth = new VaultAuth(
    chart,
    chart.node.id,
    "vault-secrets-operator",
  );

  const vaultSecret = new VaultStaticSecret(
    chart,
    vaultAuth,
    "secrets",
    chart.node.id,
  );

  const externalUrl = new URL("https://grafana.bulia.dev");
  new Grafana(chart, `${id}-grafana`, {
    metadata: { name: "grafana", labels: { instance: id } },
    spec: {
      config: {
        analytics: {
          check_for_plugin_updates: "false",
          check_for_updates: "false",
          feedback_links_enabled: "false",
          reporting_enabled: "false",
        },
        log: {
          mode: "console",
        },
        server: {
          root_url: externalUrl.toString(),
        },
      },
      deployment: {
        spec: {
          template: {
            metadata: {
              labels: {
                "app.kubernetes.io/name": "grafana",
              },
            },
            spec: {
              containers: [
                {
                  name: "grafana",
                  env: [
                    {
                      name: "GF_SECURITY_ADMIN_USER",
                      value: "admin",
                    },
                    {
                      name: "GF_SECURITY_ADMIN_PASSWORD",
                      valueFrom: {
                        secretKeyRef: {
                          key: "admin-password",
                          name: getField(
                            vaultSecret.secret,
                            "spec.destination.name",
                          ),
                        },
                      },
                    },
                  ],
                },
                {
                  image: "ghcr.io/kiwigrid/k8s-sidecar:1.24.5",
                  name: "dashboard-sidecar",
                  env: [
                    {
                      name: "LABEL",
                      value: "grafana_dashboard",
                    },
                    {
                      name: "LABEL_VALUE",
                      value: "1",
                    },
                    {
                      name: "FOLDER",
                      value: "/var/lib/grafana/dashboards",
                    },
                    {
                      name: "NAMESPACE",
                      value: "ALL",
                    },
                    {
                      name: "RESOURCE",
                      value: "configmap",
                    },
                  ],
                  volumeMounts: [
                    {
                      name: "dashboards",
                      mountPath: "/var/lib/grafana/dashboards",
                    },
                  ],
                },
              ],
            },
          },
        },
      },
      disableDefaultAdminSecret: true,
    },
  });

  new HttpRoute(chart, "trusted", externalUrl.hostname).match(
    {
      name: "grafana-service",
      kind: "Service",
    },
    3000,
  );

  return chart;
};
