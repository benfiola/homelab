---
title: GitOps
---

**FluxCD** is used for GitOps.

## Requirements

- **Operational simplicity**: minimal complexity, minimal resource overhead
- **Reliability**: resources shouldn't get stuck in problematic reconciliation states

## Timeline

### 1. ArgoCD

The default choice given its adoption in the GitOps ecosystem. Its strengths were real: a polished UI, good visibility into deployments, and rich per-application configuration — application graphs show added/modified/deleted resources, and configuration can be manipulated directly through the interface. Operational costs became apparent over time:

- **Resource consumption**: requires multiple controllers and ships with HA Redis by default. Even with constrained core controller resources, performance degraded significantly — substantial overhead for a homelab.
- **Reconciliation**: aggressive polling was configured to improve reconciliation speed, but this meant a wedged application stayed wedged. Recovery required manually terminating reconciliations (often repeatedly) and timing an application refresh between cycles.
- **Defaulting controllers**: ArgoCD couldn't properly handle resources managed by controllers that performed field defaulting. Manifests would receive fields absent from the original, causing reconciliation flapping and requiring per-resource annotation overrides.

When rebuilding the project, these pain points prompted a full evaluation of alternatives.

### 2. FluxCD

FluxCD takes a different approach: four controllers ship, but only two (`source` and `kustomization`) actively matter for this setup. There's no annotation-based per-resource configuration, no app-of-apps framework, no UI, and no HA Redis.

Instead, FluxCD relies on Kubernetes primitives — Kustomize, server-side apply, and managed fields. Resources reconcile predictably and rarely get stuck. Aside from one minor modification to preserve resource ordering in generated Kustomization files, it worked reliably out of the box. The entire platform is managed via CLI.

## Outcome

FluxCD handles all GitOps reconciliation. Its low resource overhead and reliance on Kubernetes-native primitives keep operational overhead low, which matters for a homelab where added complexity translates directly into maintenance burden.

## Further Reading

Refer to [Iterating on Templates](/development/iterating-on-templates.md) for how to temporarily suspend Flux reconciliation while developing.
