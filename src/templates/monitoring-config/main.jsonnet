local mixin = (import 'kubernetes-mixin/mixin.libsonnet');
local rules = mixin.prometheusRules;
local alerts = mixin.prometheusAlerts;
local dashboards = mixin.grafanaDashboards;

{
  alerts: alerts.groups,
  dashboards: dashboards,
  rules: rules.groups
}