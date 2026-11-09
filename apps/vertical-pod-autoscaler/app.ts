import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  const security = h.securityContext();

  await ns.helm(
    "https://kubernetes.github.io/autoscaler/vertical-pod-autoscaler?version=0.15.0",
    {
      values: {
        admissionController: {
          certGen: { enabled: false },
          certManager: { enabled: true, issuerRef: { name: "self-signed" } },
        },
        containerSecurityContext: security.container,
        podSecurityContext: security.pod,
        recommender: {
          extraArgs: [
            "--round-cpu-millicores=25",
            "--round-memory-bytes=16777216",
          ],
        },
        updater: {
          extraArgs: [
            "--in-place-skip-disruption-budget=true",
            "--min-replicas=1",
          ],
        },
      },
    },
  );

  const advisory = { advisory: true };
  ns.vpa(
    {
      kind: "Deployment",
      name: "vertical-pod-autoscaler-admission-controller",
    },
    advisory,
  );
  ns.vpa(
    { kind: "Deployment", name: "vertical-pod-autoscaler-recommender" },
    advisory,
  );
  ns.vpa(
    { kind: "Deployment", name: "vertical-pod-autoscaler-updater" },
    advisory,
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
