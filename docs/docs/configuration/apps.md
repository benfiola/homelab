---
title: Apps
---

Apps define the workloads deployed to your cluster. Each app is an instance of a template, configured via `config/apps.yaml`.

## How It Works

### Exclude from Flux

:::tip
Generally, you want Flux to automatically reconcile your application changes.

Use this option to produce manifests that you intend to manually apply.
:::

Apps are deployed via Flux using an apps-of-apps pattern. Apps marked with `flux: true` (the default) are included in Flux reconciliation. Use `flux: false` for bootstrap manifests that initialize the cluster itself (e.g., `flux-bootstrap`).

### Uniqueness

:::info Singletons
Some templates are intentionally configured to be singletons in cases where several instances of a template cannot co-exist (or, where it simply doesn't make sense). In these cases, the `id` field is ignored and the template name is always used.
:::

The `id` field allows you to deploy the same template multiple times with different configurations. If not specified, `id` defaults to the template name.

### Dependencies

:::tip Eventual Consistency
Generally, a guiding philosophy for Kubernetes deployments is that everything should _eventually_ reconcile and stabilize. Use dependencies if, for some reason, eventual consistency isn't sufficient
:::

Dependencies establish deployment order via Flux dependencies. If `B` depends on `A` - flux will ensure `A` is reconciled before deploying `B`.

### Template Options

The `options` field is template-specific and enables applications to customize templates, thus influencing the generated manifests.

## Configuration

```yaml
# Bootstrap manifests (manually applied)
- template: flux-bootstrap
  flux: false

# Core cluster services with dependencies
- template: cert-manager
  id: cert-manager

- template: cilium

- template: external-dns
  dependencies:
    - cert-manager

# Monitoring stack
- template: prometheus-operator
  id: prometheus-operator

- template: prometheus
  dependencies:
    - prometheus-operator

- template: grafana
  dependencies:
    - prometheus
```

## Schema

**File**: `config/apps.yaml`

Applications are defined as an array of app configurations.

| Field          | Type    | Required | Description                                                          |
| -------------- | ------- | -------- | -------------------------------------------------------------------- |
| `template`     | string  | ✓        | Template name to use for this app                                    |
| `id`           | string  |          | App identifier (defaults to template name if not specified)          |
| `dependencies` | array   |          | List of app IDs this app depends on                                  |
| `flux`         | boolean |          | Whether to include this app in Flux reconciliation (default: `true`) |
| `options`      | object  |          | Template-specific options/configuration                              |
