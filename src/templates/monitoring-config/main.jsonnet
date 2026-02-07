local mixin = (import 'kubernetes-mixin/mixin.libsonnet');

local rules = mixin.prometheusRules.groups;

local alerts = [
  group
  for group in mixin.prometheusAlerts.groups
  if std.findSubstr('kube-proxy', group.name) == []
];

local dashboards = {
  [name]: mixin.grafanaDashboards[name]
  for name in std.objectFields(mixin.grafanaDashboards)
  if std.findSubstr('windows', name) == [] && std.findSubstr('proxy', name) == []
};

{
  alerts: alerts,
  dashboards: dashboards,
  rules: rules
}