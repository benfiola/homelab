import type { AppFunction } from "../../tools/lib/app.ts";
import { dashboardConfigMaps } from "../../tools/lib/k8s/monitoring.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  // { dashboards } (see main.jsonnet)
  const mixin = await ns.jsonnet("main.jsonnet");

  // grafana picks up any ConfigMap labelled as a dashboard
  ns.add(...dashboardConfigMaps(h.app, mixin.dashboards));
};
