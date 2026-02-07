local mixin = (import 'kubernetes-mixin/mixin.libsonnet');

local rules = mixin.prometheusRules;

local alerts = mixin.prometheusAlerts;

local dashboards = {
  [name]: mixin.grafanaDashboards[name]
  for name in std.objectFields(mixin.grafanaDashboards)
  if std.findSubstr('windows', name) == []
};

{
  alerts: alerts.groups,
  dashboards: dashboards,
  rules: rules.groups
}