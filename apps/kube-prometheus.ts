import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import { dump } from "js-yaml";
import {
  Certificate,
  CertificateSpecPrivateKeyAlgorithm,
  ClusterIssuer,
} from "../resources/cert-manager/cert-manager.io";
import { Namespace } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import {
  createNetworkPolicy,
  createTargets,
  specialTargets,
} from "../utils/createNetworkPolicyNew";
import { createSealedSecret } from "../utils/createSealedSecret";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { getIngressClassName } from "../utils/getIngressClassName";
import { getPodLabels } from "../utils/getPodLabels";
import { getPodRequests } from "../utils/getPodRequests";
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";
import { getStorageClassName } from "../utils/getStorageClassName";
import { parseEnv } from "../utils/parseEnv";

const helmData = {
  chart: "kube-prometheus-stack",
  version: "75.6.0",
  repo: "https://prometheus-community.github.io/helm-charts",
};

const namespace = "kube-prometheus";

export const policyTargets = createTargets((b) => ({
  alertmanager: b.pod(namespace, "alertmanager-kube-prometheus", {
    mgmt: [8080, "tcp"],
    api: [9093, "tcp"],
  }),
  grafana: b.pod(namespace, "kube-prometheus-grafana", { api: [3000, "tcp"] }),
  kubeStateMetrics: b.pod(namespace, "kube-prometheus-kube-state-metrics", {
    api: [8080, "tcp"],
  }),
  operator: b.pod(namespace, "kube-prometheus-operator", {
    api: [10250, "tcp"],
  }),
  prometheus: b.pod(namespace, "prometheus-kube-prometheus", {
    api: [9090, "tcp"],
  }),
}));

const manifests: ManifestsCallback = async (app) => {
  const { PrometheusRule } = await import(
    "../resources/kube-prometheus/monitoring.coreos.com"
  );

  const env = parseEnv((zod) => ({
    ALERTMANAGER_GMAIL_PASSWORD: zod.string(),
    GRAFANA_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "kube-prometheus", {
    namespace,
  });

  createNetworkPolicy(chart, (b) => {
    const pt = policyTargets;
    const st = specialTargets;
    const gmail = b.target({
      dns: "smtp.gmail.com",
      ports: { smtp: [587, "tcp"] },
    });
    const grafana = b.target({
      dns: "grafana.com",
      ports: { api: [443, "tcp"] },
    });
    const googleApis = b.target({
      dns: "storage.googleapis.com",
      ports: { api: [443, "tcp"] },
    });
    const ingress = b.target({ entity: "ingress" });

    b.rule(ingress, pt.alertmanager, "api");
    b.rule(ingress, pt.grafana, "api");
    b.rule(ingress, pt.prometheus, "api");
    b.rule(pt.alertmanager, gmail, "smtp");
    b.rule(pt.grafana, googleApis, "api");
    b.rule(pt.grafana, grafana, "api");
    b.rule(pt.grafana, pt.prometheus, "api");
    b.rule(pt.grafana, st.kubeApiserver, "api");
    b.rule(pt.kubeStateMetrics, st.kubeApiserver, "api");
    b.rule(pt.operator, st.kubeApiserver, "api");
    b.rule(pt.prometheus, pt.alertmanager, "api", "mgmt");
    b.rule(pt.prometheus, pt.grafana, "api");
    b.rule(pt.prometheus, pt.kubeStateMetrics, "api");
    b.rule(pt.prometheus, pt.operator, "api");
    b.rule(pt.prometheus, st.kubeApiserver, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
      // kube-prometheus has privileged workloads (the node-exporter depends on hostpath)
      labels: {
        ...getPrivilegedNamespaceLabels(),
      },
    },
  });

  const grafanaSecret = await createSealedSecret(
    chart,
    "grafana-sealed-secret",
    {
      metadata: {
        namespace: chart.namespace,
        name: "grafana-admin",
      },
      stringData: {
        "admin-password": env.GRAFANA_PASSWORD,
        "admin-user": "admin",
      },
    }
  );

  const cert = new Certificate(chart, "certificate", {
    metadata: {
      namespace: "cert-manager",
      name: "kube-prometheus",
    },
    spec: {
      commonName: "kube-prometheus",
      duration: "2160h",
      isCa: true,
      issuerRef: {
        name: "root",
        kind: "ClusterIssuer",
        group: "cert-manager.io",
      },
      privateKey: {
        algorithm: CertificateSpecPrivateKeyAlgorithm.ECDSA,
        size: 256,
      },
      // NOTE: secretName intentionally matches metadata.name
      secretName: "kube-prometheus",
    },
  });

  const issuer = new ClusterIssuer(chart, "issuer", {
    metadata: {
      namespace: "cert-manager",
      name: "kube-prometheus",
    },
    spec: {
      ca: {
        secretName: cert.name,
      },
    },
  });

  await createSealedSecret(chart, "sealed-secret-alertmanager", {
    metadata: {
      namespace: chart.namespace,
      name: "alertmanager-kube-prometheus",
    },
    stringData: {
      "alertmanager.yaml": dump({
        global: {
          resolve_timeout: "5m",
        },
        inhibit_rules: [
          {
            source_matchers: ["severity = critical"],
            target_matchers: ["severity =~ warning|info"],
            equal: ["namespace", "alertname"],
          },
          {
            source_matchers: ["severity = warning"],
            target_matchers: ["severity =~ info"],
            equal: ["namespace", "alertname"],
          },
          {
            source_matchers: ["alertname = InfoInhibitor"],
            target_matchers: ["severity = info"],
            equal: ["namespace"],
          },
          { target_matchers: ["alertname = InfoInhibitor"] },
        ],
        route: {
          group_by: ["namespace"],
          group_wait: "30s",
          group_interval: "5m",
          repeat_interval: "12h",
          receiver: "benfiola@gmail.com",
          routes: [{ receiver: "null", matchers: ["alertname = Watchdog"] }],
        },
        receivers: [
          {
            name: "null",
          },
          {
            name: "benfiola@gmail.com",
            email_configs: [
              {
                from: "noreply.benfiola.homelab@gmail.com",
                to: "benfiola@gmail.com",
                smarthost: "smtp.gmail.com:587",
                auth_username: "noreply.benfiola.homelab@gmail.com",
                auth_identity: "noreply.benfiola.homelab@gmail.com",
                auth_password: env.ALERTMANAGER_GMAIL_PASSWORD,
                headers: {
                  Subject:
                    'homelab alert: {{ template "email.default.subject" . }}',
                },
              },
            ],
          },
        ],
      }),
    },
  });

  new Helm(chart, "helm-kube-prometheus", {
    ...helmData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      alertmanager: {
        alertmanagerSpec: {
          podMetadata: {
            labels: {
              // this resource is created by the alertmanager operator and needs pod labels manually defined
              ...getPodLabels("alertmanager-kube-prometheus"),
            },
          },
          // do not auto generate configuration
          useExistingSecret: true,
          // provide persistent storage for alertmanager
          storage: {
            volumeClaimTemplate: {
              spec: {
                accessModes: ["ReadWriteOnce"],
                resources: {
                  requests: {
                    storage: "50Gi",
                  },
                },
                storageClassName: getStorageClassName(),
              },
            },
          },
        },
        // expose alertmanager via ingress
        ingress: {
          enabled: true,
          hosts: ["alertmanager.bulia"],
          ingressClassName: getIngressClassName(),
          pathType: "Prefix",
        },
      },
      // produce cleaner resource names
      cleanPrometheusOperatorObjectNames: true,
      // required to ensure that the prometheus-operator kubelet service is deduplicated on redeployment
      fullnameOverride: "kube-prometheus",
      grafana: {
        admin: {
          // use sealed secret to configure admin credentials
          existingSecret: grafanaSecret.name,
        },
        // give resource names a static prefix
        fullnameOverride: "kube-prometheus-grafana",
        "grafana.ini": {
          analytics: {
            // generally prevent grafana from phoning home
            check_for_plugin_updates: false,
            check_for_updates: false,
            feedback_links_enabled: false,
            reporting_enabled: false,
          },
        },
        // expose grafana via ingress
        ingress: {
          enabled: true,
          hosts: ["grafana.bulia"],
          ingressClassName: getIngressClassName(),
        },
        // resources for grafana
        resources: getPodRequests({ mem: 500 }),
        sidecar: {
          dashboards: {
            // enable dashboard discovery
            enabled: true,
            // specify annotation mapping to desired grafana dashboard folder
            folderAnnotation: "grafana_folder",
            // search all namespaces for annotated dashboards
            searchNamespace: "ALL",
          },
          datasources: {
            // enable datasource discovery
            enabled: true,
            // search all namespaces for annotated dashboards
            searchNamespace: "ALL",
          },
        },
      },
      kubeControllerManager: {
        // disabled because it requires running kube-controller-manager bound to 0.0.0.0
        enabled: false,
      },
      kubeProxy: {
        // kube-proxy not in use (- cilium is used instead).  disable monitoring.
        enabled: false,
      },
      kubeScheduler: {
        // disabled because it requires running kube-scheduler bound to 0.0.0.0
        enabled: false,
      },
      "kube-state-metrics": {
        // give resources a static prefix
        fullnameOverride: "kube-prometheus-kube-state-metrics",
      },
      prometheus: {
        // expose prometheus via ingress
        ingress: {
          enabled: true,
          hosts: ["prometheus.bulia"],
          ingressClassName: getIngressClassName(),
          pathType: "Prefix",
        },
        prometheusSpec: {
          podMetadata: {
            labels: {
              // this resource is created by the prometheus operator and needs its pod labels manually defined
              ...getPodLabels("prometheus-kube-prometheus"),
            },
          },
          // allow the prometheus operator to manage non-annotated pod monitor resources
          podMonitorSelectorNilUsesHelmValues: false,
          // allow the prometheus operator to manage non-annotated probe selector resources
          probeSelectorNilUsesHelmValues: false,
          // constrain resources for prometheus workload
          resources: getPodRequests({ cpu: 300, mem: 2500 }),
          // allow the prometheus operator to manage non-annotated rule selector resources
          ruleSelectorNilUsesHelmValues: false,
          // allow the prometheus operator to manage non-annotated scrape config resources
          scrapeConfigSelectorNilUsesHelmValues: false,
          // allow the prometheus operator to manage non-annotated service monitor resources
          serviceMonitorSelectorNilUsesHelmValues: false,
          // provide persistent storage for prometheus
          // NOTE: if pvc created without storage provider, deployment is blocked.  wait until after initial deployment.
          storageSpec: {
            volumeClaimTemplate: {
              spec: {
                accessModes: ["ReadWriteOnce"],
                resources: {
                  requests: {
                    storage: "50Gi",
                  },
                },
                storageClassName: getStorageClassName(),
              },
            },
          },
        },
      },
      "prometheus-node-exporter": {
        // give resource names a static prefix
        fullnameOverride: "kube-prometheus-prometheus-node-exporter",
      },
      prometheusOperator: {
        admissionWebhooks: {
          certManager: {
            // use certmanager to generate certificates for admission webhooks
            admissionCert: {
              // configures duration of certificate to be half that of the issuer
              duration: "1080h",
            },
            enabled: true,
            issuerRef: {
              name: issuer.name,
              kind: issuer.kind,
              group: issuer.apiGroup,
            },
          },
        },
      },
    },
  });

  new PrometheusRule(chart, "prometheus-rules-custom", {
    metadata: {
      namespace: chart.namespace,
      name: "custom",
    },
    spec: {
      groups: [
        {
          name: "custom",
          rules: [
            {
              alert: "PodOomKilled",
              annotations: {
                description:
                  "Pod {{$labels.namespace}}/{{$labels.pod}} was recently OOMKilled.",
                summary: "Pod was recently OOMKilled",
              },
              expr: {
                value: `sum by(namespace, pod) (kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}) > 0`,
              } as any,
              for: "30s",
              labels: {
                severity: "critical",
              },
            },
          ],
        },
      ],
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestsFile) => {
  const manifest = await exec(getHelmTemplateCommand(helmData));
  await writeFile(manifestsFile, manifest);
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
