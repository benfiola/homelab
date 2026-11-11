local mixin = (import 'mixin/mixin.libsonnet') + {
  // the job the PodMonitor produces: <namespace>/<name>
  _config+:: { prometheusOperatorSelector: 'job="prometheus-operator/prometheus-operator"' },
};

{
  alerts: mixin.prometheusAlerts.groups,
}
