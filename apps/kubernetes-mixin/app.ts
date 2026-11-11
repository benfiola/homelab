import type { AppFunction } from "../../tools/lib/app.ts";

// kubernetes names can't contain the '.' and '_' the mixin's names do
const k8sName = (name: string) => name.replace(/[._]/g, "-");

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  // { alerts, dashboards, rules } from the kubernetes-mixin (see main.jsonnet)
  const mixin = await ns.jsonnet("main.jsonnet");

  const prometheusRule = (name: string, group: Record<string, any>) =>
    ns.add({
      apiVersion: "monitoring.coreos.com/v1",
      kind: "PrometheusRule",
      metadata: { name },
      spec: { groups: [group] },
    });
  for (const group of mixin.rules) {
    prometheusRule(`rule--${k8sName(group.name)}`, group);
  }
  for (const group of mixin.alerts) {
    prometheusRule(`alert--${k8sName(group.name)}`, group);
  }

  // grafana picks up any ConfigMap labelled as a dashboard
  for (const [name, dashboard] of Object.entries(mixin.dashboards)) {
    ns.add({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: `dashboard--${k8sName(name)}`,
        labels: { grafana_dashboard: "1" },
        annotations: { grafana_folder: h.app },
      },
      data: { [name]: JSON.stringify(dashboard) },
    });
  }
};
