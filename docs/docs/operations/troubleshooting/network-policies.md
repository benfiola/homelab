---
title: Network Policies
---

Observe and troubleshoot network policies to verify they're allowing or blocking traffic as intended.

:::tip Missing flows?
Some flows are only established during pod startup. If you're not seeing expected traffic, try restarting the relevant pods to trigger those initialization flows.
:::

## Hubble UI

Hubble UI provides per-namespace visibility into pod traffic (ingress/egress). It's available at [cilium.bulia.dev](https://cilium.bulia.dev).

**Limitations:**

- Some flows are aggregated and hidden from the traffic map view
- Only displays per-namespace views (harder to see cluster-wide policy effects)
- Only shows flows captured while the UI is actively running
- Pod-to-selector mapping isn't intuitive in the UI

**Best for**: Quick, visual exploration of traffic within a namespace.

## Hubble Relay (CLI)

For detailed flow logs, query Hubble Relay directly via CLI.

**Setup** (run in a separate terminal):

```bash
cilium hubble port-forward --namespace cilium
```

### Common queries

View all allowed flows alongside the enforced policy:

```bash
hubble observe --verdict ALLOWED --print-policy-names
```

View dropped flows from a specific pod:

```bash
hubble observe --from-pod my-namespace/my-pod --verdict DROPPED
```

Stream live traffic to a namespace in real-time:

```bash
hubble observe --to-namespace my-namespace --follow
```

### Available flags

For more fine-grained filtering, use these flags with `hubble observe`:

- `--[from|to]-namespace NS` - Filter by namespace
- `--[from|to]-pod NS/POD` - Filter by pod
- `--traffic-direction [ingress|egress]` - Filter by direction
- `--verdict [ALLOWED|DROPPED|AUDITED]` - Filter by policy outcome
- `--since DURATION` - Time window (e.g., `5m`)
- `--follow` - Stream live flows
- `--print-policy-names` - Show which policy allowed/dropped the flow
- `--output json` - Raw JSON output

## Analyzing hubble flows

The `homelab analyze-hubble-flows` command processes flow streams from Hubble, presenting a simplified view that's easier to reason about when iterating on network policies.

### Usage

Pipe `hubble observe` directly to the analyzer:

```bash
hubble observe --output=json | homelab analyze-hubble-flows -
```

Or save flows to a file and analyze later:

```bash
hubble observe --output=json > flows.json
homelab analyze-hubble-flows flows.json
```

### Output format

Each line represents a single flow with a direction, source, destination, and protocol/port:

```
← world:203.0.113.45 ⟶ node:worker-01 (tcp/443)
→ node:worker-01 ⟶ pod:vault{c:server, p:vault} (tcp/8201)
→ pod:monitoring{c:prometheus, p:prometheus} ⟶ pod:loki{c:gateway, p:loki} (tcp/8080)
→ node:worker-01 ⟶ node:worker-02 (udp/6081)
```

**Legend:**

:::info Pod Labels
These pod labels directly correspond to the selector functions in the [network policy builder](https://github.com/benfiola/homelab/blob/main/src/templates/network-policy/policyBuilder.ts).

For example, when you see `pod:vault{c:server, p:vault}` in the output, you can write a policy using `component("server", "vault")` and `pod("vault", "vault")` selectors.
:::

- `←` = ingress, `→` = egress
- `world:IP` = external traffic
- `node:NAME` = host-level traffic (e.g., CNI tunneling)
- `pod:NAMESPACE{LABELS}` = pod with matching labels
  - `c:` = component label
  - `p:` = pod name label
  - `ka:` = k8s-app label
  - `g:` = gateway label
- `(protocol/port)` = destination port and protocol
