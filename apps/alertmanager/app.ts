import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dashboardConfigMaps,
  prometheusRules,
} from "../../tools/lib/k8s/monitoring.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  ns.add({
    apiVersion: "monitoring.coreos.com/v1alpha1",
    kind: "AlertmanagerConfig",
    metadata: {
      name: "config",
    },
    spec: {
      inhibitRules: [
        {
          equal: ["namespace", "alertname"],
          sourceMatch: [
            {
              matchType: "=",
              name: "severity",
              value: "critical",
            },
          ],
          targetMatch: [
            {
              matchType: "=~",
              name: "severity",
              value: "warning|info",
            },
          ],
        },
        {
          equal: ["namespace", "alertname"],
          sourceMatch: [
            {
              matchType: "=",
              name: "severity",
              value: "warning",
            },
          ],
          targetMatch: [
            {
              matchType: "=~",
              name: "severity",
              value: "info",
            },
          ],
        },
        {
          equal: ["namespace"],
          sourceMatch: [
            {
              matchType: "=",
              name: "alertname",
              value: "InfoInhibitor",
            },
          ],
          targetMatch: [
            {
              matchType: "=",
              name: "severity",
              value: "info",
            },
          ],
        },
        {
          targetMatch: [
            {
              matchType: "=",
              name: "alertname",
              value: "InfoInhibitor",
            },
          ],
        },
      ],
      receivers: [
        {
          name: "null",
        },
        {
          emailConfigs: [
            {
              from: "noreply@cluster.fiola.dev",
              headers: [
                {
                  key: "Subject",
                  value:
                    "[ALERT] cluster.fiola.dev: {{ len .Alerts }} active alerts",
                },
              ],
              smarthost: "postfix-mail-headless.postfix.svc:587",
              tlsConfig: {
                insecureSkipVerify: true,
              },
              to: "me@benfiola.com",
            },
          ],
          name: "noreply@cluster.fiola.dev",
        },
      ],
      route: {
        groupBy: ["cluster"],
        groupInterval: "5m",
        groupWait: "30s",
        receiver: "noreply@cluster.fiola.dev",
        repeatInterval: "12h",
        routes: [
          {
            matchers: [
              {
                matchType: "=",
                name: "alertname",
                value: "Watchdog",
              },
            ],
            receiver: "null",
          },
        ],
      },
    },
  });

  const security = h.securityContext();

  ns.add({
    apiVersion: "monitoring.coreos.com/v1",
    kind: "Alertmanager",
    metadata: { name: "alertmanager" },
    spec: {
      alertmanagerConfiguration: {
        global: { resolveTimeout: "5m" },
        name: "config",
      },
      containers: [
        { name: "alertmanager", securityContext: security.container },
        {
          name: "config-reloader",
          securityContext: security.container,
          resources: { requests: { cpu: "25m", memory: "128Mi" } },
        },
      ],
      // replicas must be set for autoscaling
      replicas: 1,
      securityContext: security.pod,
      initContainers: [
        {
          name: "init-config-reloader",
          securityContext: security.container,
          resources: { requests: { cpu: "10m", memory: "64Mi" } },
        },
      ],
      storage: {
        volumeClaimTemplate: {
          metadata: { name: "data" },
          spec: {
            resources: { requests: { storage: "10Gi" } },
            storageClassName: "standard",
          },
        },
      },
    },
  });

  const mixin = await ns.jsonnet("main.jsonnet");
  ns.add(
    ...prometheusRules("alert", mixin.alerts),
    ...dashboardConfigMaps(h.app, mixin.dashboards),
  );

  ns.podMonitor(
    "alertmanager",
    { "app.kubernetes.io/name": "alertmanager" },
    "web",
  );

  ns.vpa({
    kind: "Alertmanager",
    name: "alertmanager",
    apiVersion: "monitoring.coreos.com/v1",
  });
};

export const network: NetworkFunction = (n) => {
  const alertmanager = n.subject(
    "alertmanager",
    pod("alertmanager", "alertmanager"),
  );

  alertmanager.to(n.ref("postfix"), tcp(587));
  n.host.to(alertmanager, tcp(9093));
};
