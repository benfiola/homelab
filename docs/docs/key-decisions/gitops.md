---
title: GitOps
---

I use **FluxCD** for GitOps. It's simpler, more reliable, and better aligned with my operational model than the alternatives. Here's how I arrived at this choice.

## Decision Criteria

When evaluating GitOps platforms, I prioritized:

- **Operational simplicity**: Minimal complexity, minimal resource overhead
- **Reliability**: Resources shouldn't get stuck in problematic reconciliation states

## The Journey

### Initial Path: ArgoCD

ArgoCD seemed like the obvious choice—it dominates the GitOps landscape. Its strengths are real: a polished UI, excellent visibility into deployments, and rich per-application configuration. Application graphs clearly show added/modified/deleted resources, and you can manipulate configuration directly through the interface.

But the operational costs became apparent:

**Resource consumption**: ArgoCD requires multiple controllers and ships with HA Redis by default. Even constraining core controller resources significantly degraded performance. For a homelab, this overhead was substantial.

**Fragile reconciliation**: To improve reconciliation speed, I configured aggressive polling. This created a trap: when an application wedged, it stayed wedged. Recovery required manually terminating reconciliations (often repeatedly) and timing an application refresh between cycles. This felt brittle.

**Incompatibility with defaulting controllers**: ArgoCD couldn't properly handle resources managed by controllers that performed field defaulting. Manifests would receive fields absent from the original causing resource reconciliation flapping - forcing per-resource annotation overrides.

When rebuilding the project, these pain points prompted a full evaluation of alternatives.

### FluxCD: Radical Simplicity

FluxCD takes a different philosophy. It uses four controllers, but only two actively matter: `source` and `kustomization`. There's no advanced annotation-based per-resource configuration, no sophisticated app-of-apps framework, no UI, and no HA Redis.

Instead, FluxCD embraces Kubernetes primitives: Kustomize, server-side apply, and managed fields. The result is elegant: resources reconcile predictably, get stuck rarely (if at all), and integrate naturally with the cluster's native tooling.

Aside from one minor modification to preserve resource ordering in generated Kustomization files, everything works immediately and reliably. The entire platform is managed via CLI.

## Final Architecture

**FluxCD** handles all GitOps reconciliation. Its simplicity and alignment with Kubernetes' native primitives make it operationally transparent and reliable. For a homelab where complexity directly translates to maintenance burden, it's the right choice.

## Further Reading

Refer to [Iterating on Templates](/development/iterating-on-templates.md) for how to temporarily suspend Flux reconciliation while developing.
