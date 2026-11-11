local mixin = (import 'alertmanager-mixin/mixin.libsonnet') + {
  // the job the PodMonitor produces: <namespace>/<name>
  _config+:: { alertmanagerSelector: 'job="alertmanager/alertmanager"' },
};

{
  alerts: mixin.prometheusAlerts.groups,
  dashboards: mixin.grafanaDashboards,
}
