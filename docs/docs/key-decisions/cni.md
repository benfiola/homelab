---
title: Container Network Interface (CNI)
---

I run **Cilium** as my CNI with **Envoy Gateway** for ingress. This combination balances three requirements: observability and performance, operational clarity, and feature completeness. Here's how I arrived at this decision.

## Decision Criteria

Three factors drove my evaluation:

- **Operational clarity**: Can I understand the configuration and troubleshoot issues independently?
- **Feature completeness**: Does it support the policies and traffic management I need?
- **Performance and observability**: Can I monitor cluster traffic and identify issues?

## The Journey

### Initial Path: Cilium

Cilium seemed like the obvious choice. Its eBPF-based performance and open-source Hubble UI were compelling. I deployed it and it worked—but I never felt confident about _why_. The configuration was opaque, and without deep networking expertise, I couldn't troubleshoot effectively. The open-source Hubble UI also had limitations: per-namespace visibility only, and flow aggregation that obscured some traffic patterns.

When rebuilding this project, I decided to try something simpler.

### Detour: Calico

Calico's long production track record suggested it would be more operationally transparent. Configuration would be minimal and understandable.

Initially, this held. But two problems emerged:

**Resource management confusion**: `projectcalico.org/v3` resources must be deployed separately from CRDs (`crd.projectcalico.org/v1`). Using the wrong version bypasses critical validation and defaulting, causing unpredictable behavior.

**eBPF complications**: Calico's eBPF dataplane broke DNS resolution for host-networked pods within the cluster. The issue remained unresolved despite working with maintainers. Since eBPF wasn't essential, I switched to the iptables dataplane with VXLAN encapsulation—and it worked.

However, a bigger problem disqualified Calico entirely: **no support for DNS-based network policies** (only in enterprise). Critical registries like `quay.io` don't publish CIDR ranges, so allowing DNS-based policy targeting was essential. Without it, I'd need to allow unfettered egress—defeating the purpose of network policies. This forced a reckoning.

### Return to Cilium (Revised Understanding)

I returned to Cilium with my original manifests and a clearer understanding of its configuration. Setup was fast. More importantly, time spent learning the underlying tooling—particularly `hubble observe` for local debugging—made the system feel less like a black box. I was able to troubleshoot confidently.

Cilium became my platform.

### Gateway API: Where Cilium Falls Short

Cilium's Gateway API implementation works, but has a fundamental limitation: you can't write network policies targeting _specific_ gateways. You're limited to the `reserved:ingress` selector, and there's no way to refine policies with service-specific selectors. The architectural reason: Cilium's policy engine translates service-based rules into CIDR rules from EndpointSlices, and CIDR-based rules can't target Cilium-managed traffic.

This limitation made Cilium's Gateway implementation unsuitable for my needs.

### Final Choice: Envoy Gateway

I disabled Cilium's Gateway API implementation and deployed **Envoy Gateway** instead. The difference is immediate: workloads receive proper `CiliumEndpoint` resources, enabling fine-grained network policies. Additionally, Envoy Gateway has a more complete Gateway API implementation overall.

## Final Architecture

**Cilium** handles cluster networking with strong observability and policy capabilities. **Envoy Gateway** handles ingress with proper integration into Cilium's policy model. Together, they provide the operational clarity, feature completeness, and observability the cluster requires.

## Further Reading

Refer to [Troubleshooting Network Policies](/operations/troubleshooting/network-policies.md) to learn how to troubleshoot Cilium network policies.
