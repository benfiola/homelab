local mixin = (import 'cert-manager-mixin/mixin.libsonnet') + {
  _config+:: {
    certManagerReplaceExportedNamespace: true,
    grafanaExternalUrl: 'https://metrics.fiola.dev',
  },
};

{
  alerts: mixin.prometheusAlerts.groups,
  dashboards: mixin.grafanaDashboards,
}
