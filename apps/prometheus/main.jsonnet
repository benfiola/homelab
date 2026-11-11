local mixin = (import 'prometheus-mixin/mixin.libsonnet') + {
  _config+:: { prometheusSelector: 'job="prometheus/prometheus"' },
};

{
  alerts: mixin.prometheusAlerts.groups,
  dashboards: {
    [name]: mixin.grafanaDashboards[name]
    for name in std.objectFields(mixin.grafanaDashboards)
    if std.findSubstr('remote-write', name) == []
  },
}
