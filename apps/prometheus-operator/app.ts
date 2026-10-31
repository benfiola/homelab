import type { AppFunction } from "../../tools/lib/app.ts";
import { container, replace } from "../../tools/lib/k8s/edit.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.manifest(
    "https://github.com/prometheus-operator/prometheus-operator/releases/download/v0.87.0/bundle.yaml",
    {
      namespace: true,
    },
  );

  h.namespace();

  // endpoints -> endpointslices
  h.edit({ kind: "ClusterRole", name: "prometheus-operator" }, (role) => {
    const index = role.rules.findIndex(
      (rule: any) => rule.resources?.join() === "endpoints",
    );
    if (index < 0) {
      throw new Error(
        "ClusterRole/prometheus-operator has no 'endpoints' rule",
      );
    }
    role.rules[index] = {
      apiGroups: ["discovery.k8s.io"],
      resources: ["endpointslices"],
      verbs: ["create", "delete", "get", "list", "update"],
    };
  });

  h.edit({ kind: "Deployment", name: "prometheus-operator" }, (deployment) => {
    const operator = container(deployment, "prometheus-operator");
    operator.resources = { requests: { cpu: "100m", memory: "128Mi" } };
    replace(
      operator.args,
      "--kubelet-endpoints=true",
      "--kubelet-endpoints=false",
    );
    replace(
      operator.args,
      "--kubelet-endpointslice=false",
      "--kubelet-endpointslice=true",
    );
    operator.args.push(
      "--config-reloader-cpu-limit=0",
      "--config-reloader-memory-limit=0",
    );
  });

  h.vpa({ kind: "Deployment", name: "prometheus-operator" });
};

export const network: NetworkFunction = (n) => {
  const prometheusOperator = n.subject(
    "prometheus-operator",
    component("controller", "prometheus-operator"),
  );

  prometheusOperator.to(n.kubeApiServer, tcp(6443));
};
