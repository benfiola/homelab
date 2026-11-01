import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.namespace();

  h.secrets();

  h.add(
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRole",
      metadata: { name: `${h.app}-dashboard-sidecar` },
      rules: [
        {
          apiGroups: [""],
          resources: ["configmaps"],
          verbs: ["get", "list", "watch"],
        },
      ],
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRoleBinding",
      metadata: { name: `${h.app}-dashboard-sidecar` },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: `${h.app}-dashboard-sidecar`,
      },
      subjects: [
        { kind: "ServiceAccount", name: "grafana-sa", namespace: h.app },
      ],
    },
  );

  const provisioning = h.configMap(
    "provisioning",
    h.files("provisioning.yaml"),
  );

  const security = h.securityContext();
  const externalUrl = new URL("https://metrics.fiola.dev");

  h.add({
    apiVersion: "grafana.integreatly.org/v1beta1",
    kind: "Grafana",
    metadata: { name: "grafana", labels: { instance: h.app } },
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
                  resources: {
                    requests: { cpu: "100m", memory: "256Mi" },
                  },
                  env: [
                    { name: "GF_SECURITY_ADMIN_USER", value: "admin" },
                    {
                      name: "GF_SECURITY_ADMIN_PASSWORD",
                      valueFrom: h.secretKey("admin-password"),
                    },
                  ],
                  volumeMounts: [
                    {
                      name: "dashboards",
                      mountPath: "/var/lib/grafana/dashboards",
                    },
                    {
                      name: "provisioning",
                      mountPath: "/etc/grafana/provisioning/dashboards",
                    },
                  ],
                },
                {
                  image: "ghcr.io/kiwigrid/k8s-sidecar:2.14.1",
                  name: "dashboard-sidecar",
                  env: [
                    { name: "LABEL", value: "grafana_dashboard" },
                    { name: "LABEL_VALUE", value: "1" },
                    { name: "FOLDER", value: "/var/lib/grafana/dashboards" },
                    { name: "NAMESPACE", value: "ALL" },
                    { name: "RESOURCE", value: "configmap" },
                  ],
                  securityContext: security.container,
                  volumeMounts: [
                    {
                      name: "dashboards",
                      mountPath: "/var/lib/grafana/dashboards",
                    },
                  ],
                },
              ],
              volumes: [
                { name: "dashboards", emptyDir: {} },
                {
                  name: "provisioning",
                  configMap: { name: provisioning.metadata.name },
                },
              ],
            },
          },
        },
      },
      disableDefaultAdminSecret: true,
    },
  });

  h.httpRoute("infrastructure", externalUrl.hostname).match(
    { kind: "Service", name: "grafana-service" },
    3000,
  );
};

export const network: NetworkFunction = (n) => {
  const grafana = n.subject("grafana", pod("grafana", "grafana"));

  grafana
    .to(n.kubeApiServer, tcp(6443))
    .to(n.ref("loki-gateway"), tcp(8080))
    .to(n.ref("prometheus"), tcp(9090));
  n.host.to(grafana, tcp(3000));
  n.ref("gateway-infrastructure").to(grafana, tcp(3000));
};
