local mixin = (import 'mixin/mixin.libsonnet') + {
  _config+:: { prometheusOperatorSelector: 'job="prometheus-operator/prometheus-operator"' },
};

{
  alerts: mixin.prometheusAlerts.groups,
}
