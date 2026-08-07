import { Namespace } from "../../../assets/kubernetes/k8s";
import {
  Alertmanager,
  AlertmanagerConfig,
  AlertmanagerSpecContainersResourcesRequests as ContainerRequests,
  AlertmanagerSpecInitContainersResourcesRequests as InitContainerRequests,
  AlertmanagerSpecStorageVolumeClaimTemplateSpecResourcesRequests as Requests,
  AlertmanagerConfigSpecRouteMatchersMatchType as RouteMatchType,
  AlertmanagerConfigSpecInhibitRulesSourceMatchMatchType as SourceMatchType,
  AlertmanagerConfigSpecInhibitRulesTargetMatchMatchType as TargetMatchType,
} from "../../../assets/prometheus-operator/monitoring.coreos.com";
import { Chart, getSecurityContext, VerticalPodAutoscaler } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, `${id}-namespace`, {
    metadata: {
      name: chart.namespace,
    },
  });

  const config = new AlertmanagerConfig(chart, `${id}-alertmanager-config`, {
    metadata: {
      name: "config",
    },
    spec: {
      inhibitRules: [
        {
          sourceMatch: [
            {
              name: "severity",
              matchType: SourceMatchType.VALUE_EQUALS,
              value: "critical",
            },
          ],
          targetMatch: [
            {
              name: "severity",
              matchType: TargetMatchType.VALUE_EQUAL_TILDE,
              value: "warning|info",
            },
          ],
          equal: ["namespace", "alertname"],
        },
        {
          sourceMatch: [
            {
              name: "severity",
              matchType: SourceMatchType.VALUE_EQUALS,
              value: "warning",
            },
          ],
          targetMatch: [
            {
              name: "severity",
              matchType: TargetMatchType.VALUE_EQUAL_TILDE,
              value: "info",
            },
          ],
          equal: ["namespace", "alertname"],
        },
        {
          sourceMatch: [
            {
              name: "alertname",
              matchType: SourceMatchType.VALUE_EQUALS,
              value: "InfoInhibitor",
            },
          ],
          targetMatch: [
            {
              name: "severity",
              matchType: TargetMatchType.VALUE_EQUALS,
              value: "info",
            },
          ],
          equal: ["namespace"],
        },
        {
          targetMatch: [
            {
              name: "alertname",
              matchType: TargetMatchType.VALUE_EQUALS,
              value: "InfoInhibitor",
            },
          ],
        },
      ],
      receivers: [
        { name: "null" },
        {
          name: "noreply@cluster.fiola.dev",
          emailConfigs: [
            {
              headers: [
                {
                  key: "Subject",
                  value:
                    "[ALERT] cluster.fiola.dev: {{ len .Alerts }} active alerts",
                },
              ],
              from: "noreply@cluster.fiola.dev",
              smarthost: "postfix-mail-headless.postfix.svc:587",
              tlsConfig: {
                insecureSkipVerify: true,
              },
              to: "me@benfiola.com",
            },
          ],
        },
      ],
      route: {
        groupBy: ["cluster"],
        groupWait: "30s",
        groupInterval: "5m",
        repeatInterval: "12h",
        receiver: "noreply@cluster.fiola.dev",
        routes: [
          {
            receiver: "null",
            matchers: [
              {
                name: "alertname",
                matchType: RouteMatchType.VALUE_EQUALS,
                value: "Watchdog",
              },
            ],
          },
        ],
      },
    },
  });

  const securityContext = getSecurityContext();

  const alertmanager = new Alertmanager(chart, `${id}-alertmanager`, {
    metadata: { name: "alertmanager" },
    spec: {
      alertmanagerConfiguration: {
        global: {
          resolveTimeout: "5m",
        },
        name: config.name,
      },
      containers: [
        { name: "alertmanager", securityContext: securityContext.container },
        {
          name: "config-reloader",
          securityContext: securityContext.container,
          resources: {
            requests: {
              cpu: ContainerRequests.fromString("25m"),
              memory: ContainerRequests.fromString("128Mi"),
            },
            limits: null,
          },
        },
      ],
      // replicas must be set for autoscaling
      replicas: 1,
      securityContext: securityContext.pod,
      initContainers: [
        {
          name: "init-config-reloader",
          securityContext: securityContext.container,
          resources: {
            requests: {
              cpu: InitContainerRequests.fromString("10m"),
              memory: InitContainerRequests.fromString("64Mi"),
            },
            limits: null,
          },
        },
      ],
      storage: {
        volumeClaimTemplate: {
          spec: {
            resources: {
              requests: {
                storage: Requests.fromString("10Gi"),
              },
            },
            storageClassName: "standard",
          },
        },
      },
    },
  });

  new VerticalPodAutoscaler(chart, alertmanager);

  return chart;
};
