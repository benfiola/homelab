import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  const bundle = await ns.kustomize(
    "https://github.com/prometheus-operator/prometheus-operator/releases/download/v0.95.1/bundle.yaml",
  );

  // endpoints -> endpointslices
  h.postRender((e) => {
    const role = e.find({ kind: "ClusterRole", name: "prometheus-operator" });
    const endpoints = e.item(
      role.rules,
      (rule: any) => rule.resources?.join() === "endpoints",
      "rule for 'endpoints'",
    );
    e.replace(role.rules, endpoints, {
      apiGroups: ["discovery.k8s.io"],
      resources: ["endpointslices"],
      verbs: ["create", "delete", "get", "list", "update"],
    });
  });

  h.postRender((e) => {
    const deployment = e.find({
      kind: "Deployment",
      name: "prometheus-operator",
    });
    const operator = e.container(deployment, "prometheus-operator");
    operator.resources = { requests: { cpu: "100m", memory: "128Mi" } };
    e.replace(
      operator.args,
      "--kubelet-endpoints=true",
      "--kubelet-endpoints=false",
    );
    e.replace(
      operator.args,
      "--kubelet-endpointslice=false",
      "--kubelet-endpointslice=true",
    );
    operator.args.push(
      "--config-reloader-cpu-limit=0",
      "--config-reloader-memory-limit=0",
    );
  });

  bundle.find("Deployment", "prometheus-operator").podMonitor("http");

  ns.vpa({ kind: "Deployment", name: "prometheus-operator" });
};

export const network: NetworkFunction = (n) => {
  const prometheusOperator = n.subject(
    "prometheus-operator",
    component("controller", "prometheus-operator"),
  );

  prometheusOperator.to(n.kubeApiServer, tcp(6443));
  n.ref("prometheus").to(prometheusOperator, tcp(8080));
};
