local mixin = (import 'prometheus-mixin/mixin.libsonnet') + {
  // the job the PodMonitor produces: <namespace>/<name>
  _config+:: { prometheusSelector: 'job="prometheus/prometheus"' },
};

{
  alerts: mixin.prometheusAlerts.groups,
  // remote write isn't used
  dashboards: {
    [name]: mixin.grafanaDashboards[name]
    for name in std.objectFields(mixin.grafanaDashboards)
    if std.findSubstr('remote-write', name) == []
  },
}
