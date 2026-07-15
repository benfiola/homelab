---
title: Container Network Interface (CNI)
---

**Cilium** is used as the CNI, with **Envoy Gateway** for ingress.

## Requirements

- **Operational clarity**: configuration and troubleshooting should be tractable without deep networking expertise
- **Feature completeness**: needs to support the policies and traffic management required
- **Performance and observability**: cluster traffic should be visible and diagnosable

## Timeline

### Cilium (CNI)

Cilium's eBPF-based performance and open-source Hubble UI made it the starting point. It worked, but configuration was hard to reason about, and troubleshooting required networking expertise not readily available. The open-source Hubble UI was also limited: per-namespace visibility only, with some flow aggregation obscuring traffic patterns.

When rebuilding this project, evaluated Calico as an alternative (see below). After ruling it out, returned to the original Cilium manifests with a better understanding of its configuration, gained from that evaluation. Setup was fast the second time, and time spent learning `hubble observe` for local debugging made the system easier to troubleshoot directly. Adopted as the CNI.

### Calico

Calico's longer production track record suggested more transparent configuration. Two issues came up during deployment:

- **Resource versioning**: `projectcalico.org/v3` resources must be deployed separately from CRDs (`crd.projectcalico.org/v1`). Using the wrong version skips validation and defaulting, causing unpredictable behavior.
- **eBPF dataplane**: broke DNS resolution for host-networked pods; unresolved after working with maintainers. Since eBPF wasn't a requirement, switched to the iptables dataplane with VXLAN encapsulation, which worked.

The disqualifying issue: no DNS-based network policy support outside the enterprise tier. Registries like `quay.io` don't publish CIDR ranges, so DNS-based policy is needed to avoid unrestricted egress. Ruled out on this basis.

### Envoy Gateway (ingress)

Cilium's Gateway API implementation doesn't support network policies scoped to a specific gateway — only the `reserved:ingress` selector is available, with no service-specific refinement. Cause: Cilium's policy engine translates service-based rules into CIDR rules derived from EndpointSlices, and CIDR-based rules can't target Cilium-managed traffic.

Disabled Cilium's Gateway API implementation and deployed Envoy Gateway instead. Workloads now receive proper `CiliumEndpoint` resources, enabling fine-grained, per-gateway network policies. Envoy Gateway's Gateway API implementation is also more complete overall.

## Outcome

Cilium handles cluster networking, providing observability and policy enforcement. Envoy Gateway handles ingress, integrating with Cilium's policy model for per-gateway network policies.

## Further Reading

Refer to [Troubleshooting Network Policies](/operations/troubleshooting/network-policies.md) to learn how to troubleshoot Cilium network policies.
