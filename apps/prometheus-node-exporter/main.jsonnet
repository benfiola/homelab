local mixin = (import 'node-mixin/mixin.libsonnet') + {
  _config+:: { nodeExporterSelector: 'job="node-exporter"' },
};

{
  alerts: mixin.prometheusAlerts.groups,
  dashboards: {
    [name]: mixin.grafanaDashboards[name]
    for name in std.objectFields(mixin.grafanaDashboards)
    if std.findSubstr('aix', name) == [] && std.findSubstr('darwin', name) == []
  },
  rules: mixin.prometheusRules.groups,
}
