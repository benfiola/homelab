local mixin = (import 'alertmanager-mixin/mixin.libsonnet') + {
  _config+:: { alertmanagerSelector: 'job="alertmanager/alertmanager"' },
};

{
  alerts: mixin.prometheusAlerts.groups,
  dashboards: mixin.grafanaDashboards,
}
