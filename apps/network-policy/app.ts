import type { AppFunction } from "../../tools/lib/app.ts";
import {
  cidrs,
  controlPlane,
  dnsWildcard,
  health,
  host,
  icmpv4,
  kubeApiServer,
  kubeDns,
  nodes,
  pods,
  PolicyRegistry,
  tcp,
  udp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

// the policies of the whole cluster, from the `network` of every app. this app's own `network`
// declares the cluster's infrastructure: nodes, the host, dns.
export const app: AppFunction = async (h) => {
  const registry = new PolicyRegistry();

  for (const name of h.apps) {
    const network = await h.networkFunction(name);
    network?.(registry.network(name));
  }

  h.add(...registry.objects());
};

// infrastructure, and the connections that belong to no app
export const network: NetworkFunction = (n) => {
  // infrastructure entities
  n.subject("control-plane", controlPlane());
  n.subject("kube-apiserver", kubeApiServer());
  n.subject("host", host());
  n.subject("kube-dns", kubeDns());
  n.subject("nodes", nodes());
  n.subject("pods", pods());
  n.subject("health", health());

  // kube-system
  n.nodes.to(n.kubeDns, tcp(53), udp(53));
  n.host.to(n.kubeDns, tcp(8080, 8181));
  n.kubeDns
    .to(n.kubeApiServer, tcp(6443))
    .to(cidrs("192.168.88.1/32"), tcp(53), udp(53));
  n.pods.to(n.kubeDns, tcp(53), udp(53), dnsWildcard());
  // general - bgp
  n.nodes
    .from(cidrs("192.168.32.1/32"), tcp(179))
    .to(cidrs("192.168.32.1/32"), tcp(179));
  // general - cilium health
  n.nodes.to(n.nodes, tcp(4240));
  // general - dhcp
  n.nodes.to(cidrs("192.168.32.1/32"), udp(67));
  // general - dns
  n.nodes.to(cidrs("192.168.88.1/32"), tcp(53), udp(53));
  // general - geneve
  n.nodes.to(n.nodes, udp(6081));
  // general - health
  n.nodes.to(n.health);
  // general - icmp
  n.nodes.to(n.nodes, icmpv4(5, 8));
  n.nodes.to(n.pods, icmpv4(5, 8));
  // general - image registries
  // cilium 1.18 has no dns-based rules for host policies, so host egress to 0.0.0.0/32:443 is allowed
  n.nodes.to(cidrs("0.0.0.0/0"), tcp(443));
  // general - kube-apiserver
  n.nodes.to(n.kubeApiServer, tcp(6443));
  n.controlPlane.from(cidrs("192.168.32.0/24", "192.168.34.0/24"), tcp(6443));
  // general - kubelet
  n.nodes.to(n.nodes, tcp(10250));
  // general - mdns
  n.host
    .to(cidrs("224.0.0.251/32"), udp(5353))
    .from(cidrs("224.0.0.251/32"), udp(5353));
  // general - nas
  n.nodes.to(cidrs("192.168.32.7/32"), tcp(111, 2049));
  // general - talos
  n.nodes.to(n.nodes, tcp(50000));
  n.controlPlane.from(cidrs("192.168.32.0/24", "192.168.34.0/24"), tcp(50000));
  n.nodes.to(n.controlPlane, tcp(50001));
  // general - timeserver
  n.nodes.to(cidrs("162.159.200.1/32", "162.159.200.123/32"), udp(123));
};
