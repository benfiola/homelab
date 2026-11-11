local mixin = import 'alloy-mixin/mixin.libsonnet';

local unused = ['cluster', 'logs', 'opentelemetry', 'otel', 'remote-write'];

{
  alerts: [
    group
    for group in mixin.prometheusAlerts.groups
    if group.name == 'alloy_controller'
  ],
  dashboards: {
    [name]: mixin.grafanaDashboards[name]
    for name in std.objectFields(mixin.grafanaDashboards)
    if std.length([word for word in unused if std.findSubstr(word, name) != []]) == 0
  },
}
