import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dashboard,
  dashboardConfigMaps,
  prometheusRules,
} from "../../tools/lib/k8s/monitoring.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  // { alerts, dashboards, rules } from the kubernetes-mixin (see main.jsonnet)
  const mixin = await ns.jsonnet("main.jsonnet");

  ns.add(
    ...prometheusRules("rule", mixin.rules),
    ...prometheusRules("alert", mixin.alerts),
  );

  // grafana picks up any ConfigMap labelled as a dashboard
  ns.add(...dashboardConfigMaps(h.app, mixin.dashboards));

  h.postRender((e) => {
    dashboard(e, "dashboard--kubelet-json", (d) =>
      d.dropPanels("Config Error Count", "Storage Operation Error Rate"),
    );
    dashboard(e, "dashboard--scheduler-json", (d) =>
      d.dropPanels("Scheduling Rate", "Scheduling latency 99th Quantile"),
    );
  });
};
