import { Certificate } from "../../../assets/cert-manager/cert-manager.io";
import {
  Chart,
  getField,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const certificate = new Certificate(
    chart,
    `${id}-certificate-admission-controller`,
    {
      metadata: {
        name: "admission-controller",
      },
      spec: {
        dnsNames: [`vpa-webhook.${chart.namespace}.svc`],
        issuerRef: { name: "self-signed", kind: "ClusterIssuer" },
        // NOTE: this name matches volume/volumeMount values in the helm chart's values.yaml
        secretName: "vpa-tls-certs",
      },
    }
  );

  const helmObj = new Helm(
    chart,
    `${id}-helm`,
    context.getAsset("chart.tar.gz"),
    {
      admissionController: {
        extraArgs: [
          "--client-ca-file=/etc/tls-certs/ca.crt",
          "--reload-cert=true",
          "--tls-cert-file=/etc/tls-certs/tls.crt",
          "--tls-private-key=/etc/tls-certs/tls.key",
        ],
        tls: {
          existingSecret: getField(certificate, "spec.secretName"),
        },
      },
      updater: {
        extraArgs: ["--min-replicas=1"],
      },
    }
  );
  await patchCorrectAdmissionControllerClusterRole(helmObj);

  new VerticalPodAutoscaler(
    chart,
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "vertical-pod-autoscaler-admission-controller",
    },
    { advisory: true }
  );

  new VerticalPodAutoscaler(
    chart,
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "vertical-pod-autoscaler-recommender",
    },
    { advisory: true }
  );

  new VerticalPodAutoscaler(
    chart,
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "vertical-pod-autoscaler-updater",
    },
    { advisory: true }
  );

  return chart;
};

const patchCorrectAdmissionControllerClusterRole = async (obj: Helm) => {
  const id = obj.releaseName;

  const admissionRole = obj.node.findChild(
    `${id}-admission-controller-clusterrole`
  );

  let props: Record<string, any> = (admissionRole as any).props;
  props.rules.push(
    {
      apiGroups: ["apps"],
      resources: ["daemonsets", "deployments", "replicasets", "statefulsets"],
      verbs: ["get", "list", "watch"],
    },
    {
      apiGroups: ["batch"],
      resources: ["cronjobs", "jobs"],
      verbs: ["get", "list", "watch"],
    },
    {
      apiGroups: [""],
      resources: ["replicationcontrollers"],
      verbs: ["get", "list", "watch"],
    },
    {
      apiGroups: ["admissionregistration.k8s.io"],
      resources: ["mutatingwebhookconfigurations"],
      verbs: ["create", "delete", "get", "list", "update", "watch"],
    }
  );
};
