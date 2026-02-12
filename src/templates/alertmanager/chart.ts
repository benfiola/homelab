import { URL } from "url";
import { Namespace } from "../../../assets/kubernetes/k8s";
import {
  Alertmanager,
  AlertmanagerConfig,
  AlertmanagerSpecStorageVolumeClaimTemplateSpecResourcesRequests as Requests,
  AlertmanagerConfigSpecRouteMatchersMatchType as RouteMatchType,
  AlertmanagerConfigSpecInhibitRulesSourceMatchMatchType as SourceMatchType,
  AlertmanagerConfigSpecInhibitRulesTargetMatchMatchType as TargetMatchType,
} from "../../../assets/prometheus-operator/monitoring.coreos.com";
import {
  Chart,
  getSecurityContext,
  HttpRoute,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

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
          name: "noreply@cluster.bulia.dev",
          emailConfigs: [
            {
              headers: [
                {
                  key: "Subject",
                  value:
                    "[ALERT] cluster.bulia.dev: {{ len .Alerts }} active alerts",
                },
              ],
              from: "noreply@cluster.bulia.dev",
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
        receiver: "noreply@cluster.bulia.dev",
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

  const externalUrl = new URL("https://alertmanager.bulia.dev");
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
        { name: "config-reloader", securityContext: securityContext.container },
      ],
      externalUrl: externalUrl.toString(),
      // replicas must be set for autoscaling
      replicas: 1,
      securityContext: securityContext.pod,
      initContainers: [
        {
          name: "init-config-reloader",
          securityContext: securityContext.container,
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

  new HttpRoute(chart, ["trusted"], externalUrl.hostname).match(
    {
      kind: "Service",
      name: "alertmanager-operated",
    },
    9093,
  );

  new VerticalPodAutoscaler(chart, alertmanager);

  return chart;
};
