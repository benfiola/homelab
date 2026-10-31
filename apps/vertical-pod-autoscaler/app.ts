import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "https://kubernetes.github.io/autoscaler/vertical-pod-autoscaler?version=0.8.0",
    { values: "values.yaml" },
  );

  h.namespace();

  h.add({
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: {
      name: "admission-controller",
    },
    spec: {
      dnsNames: ["vpa-webhook.vertical-pod-autoscaler.svc"],
      issuerRef: {
        kind: "ClusterIssuer",
        name: "self-signed",
      },
      secretName: "vpa-tls-certs",
    },
  });

  const advisory = { advisory: true };
  h.vpa(
    {
      kind: "Deployment",
      name: "vertical-pod-autoscaler-admission-controller",
    },
    advisory,
  );
  h.vpa(
    { kind: "Deployment", name: "vertical-pod-autoscaler-recommender" },
    advisory,
  );
  h.vpa(
    { kind: "Deployment", name: "vertical-pod-autoscaler-updater" },
    advisory,
  );

  // the admission controller reads these, but the chart's role doesn't allow it
  h.edit(
    {
      kind: "ClusterRole",
      name: "vertical-pod-autoscaler-admission-controller",
    },
    (role) => {
      const read = ["get", "list", "watch"];
      role.rules.push(
        {
          apiGroups: ["apps"],
          resources: [
            "daemonsets",
            "deployments",
            "replicasets",
            "statefulsets",
          ],
          verbs: read,
        },
        { apiGroups: ["batch"], resources: ["cronjobs", "jobs"], verbs: read },
        { apiGroups: [""], resources: ["replicationcontrollers"], verbs: read },
        {
          apiGroups: ["admissionregistration.k8s.io"],
          resources: ["mutatingwebhookconfigurations"],
          verbs: ["create", "delete", "get", "list", "update", "watch"],
        },
        {
          apiGroups: ["garage.rajsingh.info"],
          resources: ["garageclusters/scale"],
          verbs: ["get"],
        },
      );
    },
  );
};

export const network: NetworkFunction = (n) => {
  const verticalPodAutoscalerAdmissionController = n.subject(
    "vertical-pod-autoscaler-admission-controller",
    component("admission-controller", "vertical-pod-autoscaler"),
  );
  const verticalPodAutoscalerRecommender = n.subject(
    "vertical-pod-autoscaler-recommender",
    component("recommender", "vertical-pod-autoscaler"),
  );
  const verticalPodAutoscalerUpdater = n.subject(
    "vertical-pod-autoscaler-updater",
    component("updater", "vertical-pod-autoscaler"),
  );

  n.controlPlane.to(verticalPodAutoscalerAdmissionController, tcp(8000));
  n.host.to(verticalPodAutoscalerAdmissionController, tcp(8000, 8944));
  verticalPodAutoscalerAdmissionController.to(n.kubeApiServer, tcp(6443));
  n.host.to(verticalPodAutoscalerRecommender, tcp(8942));
  verticalPodAutoscalerRecommender.to(n.kubeApiServer, tcp(6443));
  n.host.to(verticalPodAutoscalerUpdater, tcp(8943));
  verticalPodAutoscalerUpdater.to(n.kubeApiServer, tcp(6443));
};
