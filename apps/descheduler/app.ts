import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  const security = h.securityContext();

  await ns.helm(
    "https://kubernetes-sigs.github.io/descheduler/descheduler?version=0.37.0",
    {
      values: {
        kind: "Deployment",
        service: { enabled: true },
        serviceMonitor: { enabled: true },
        podSecurityContext: security.pod,
        securityContext: security.container,
        resources: { requests: { cpu: "25m", memory: "256Mi" }, limits: null },
        deschedulerPolicy: {
          profiles: [
            {
              name: "default",
              pluginConfig: [
                {
                  name: "DefaultEvictor",
                  args: {
                    nodeFit: true,
                    podProtections: {
                      defaultDisabled: ["PodsWithLocalStorage"],
                      extraEnabled: ["PodsWithPVC"],
                    },
                  },
                },
                { name: "RemoveDuplicates" },
                {
                  name: "RemovePodsHavingTooManyRestarts",
                  args: {
                    podRestartThreshold: 100,
                    includingInitContainers: true,
                  },
                },
                {
                  name: "RemovePodsViolatingNodeAffinity",
                  args: {
                    nodeAffinityType: [
                      "requiredDuringSchedulingIgnoredDuringExecution",
                    ],
                  },
                },
                { name: "RemovePodsViolatingNodeTaints" },
                { name: "RemovePodsViolatingInterPodAntiAffinity" },
                { name: "RemovePodsViolatingTopologySpreadConstraint" },
                {
                  name: "LowNodeUtilization",
                  args: {
                    thresholds: { cpu: 20, memory: 20, pods: 20 },
                    targetThresholds: { cpu: 50, memory: 50, pods: 50 },
                  },
                },
              ],
              plugins: {
                balance: {
                  enabled: [
                    "RemoveDuplicates",
                    "RemovePodsViolatingTopologySpreadConstraint",
                    "LowNodeUtilization",
                  ],
                },
                deschedule: {
                  enabled: [
                    "RemovePodsHavingTooManyRestarts",
                    "RemovePodsViolatingNodeTaints",
                    "RemovePodsViolatingNodeAffinity",
                    "RemovePodsViolatingInterPodAntiAffinity",
                  ],
                },
              },
            },
          ],
        },
      },
    },
  );

  ns.vpa({ kind: "Deployment", name: "descheduler" });
};

export const network: NetworkFunction = (n) => {
  const descheduler = n.subject(
    "descheduler",
    pod("descheduler", "descheduler"),
  );

  descheduler.to(n.kubeApiServer, tcp(6443));
  n.host.to(descheduler, tcp(10258));
  n.ref("prometheus").to(descheduler, tcp(10258));
};
