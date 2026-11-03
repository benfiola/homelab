<p style="text-align:center">
<i>Infrastructure-as-code for a cluster-in-closet.</i>
</p>

---

## Setup

The toolchain comes from a [nix](https://nixos.org) dev shell: open the devcontainer, or run `nix develop`. Run everything from the repo root; [just](https://just.systems) lists the commands.

Then, once per machine: install the dependencies (the devcontainer does this itself), sign in to Bitwarden, and set up this machine for the cluster.

```sh
just install          # install dependencies
just secrets login    # asks for a Bitwarden access token
just init             # pulls the secrets, then writes the talos and kube configuration
```

| Path             | What is in it                                                   |
| ---------------- | --------------------------------------------------------------- |
| `apps/`          | one directory per app: what to deploy, and the network it needs |
| `talos/`         | the cluster, its nodes, and their profiles                      |
| `network/`       | the router, switches, access points and WireGuard clients       |
| `bootstrap.yaml` | the order a new cluster is brought up in                        |
| `pins.json`      | the tools the dev shell pins (`kubectl`, `talosctl`, ...)       |

## Secrets

Secrets live in Bitwarden Secrets Manager. This machine keeps a copy in `~/.homelab` (a devcontainer volume, so it survives a rebuild), which the tools read by default: files others can read are refused. Neither is ever in the repository.

### Pull secrets and client configuration

`just init` pulls the secrets (the Talos bundle, the network secrets and the `apps` secrets), then writes `~/.talos/config` and `~/.kube/config` from them. The kubeconfig needs the cluster to be reachable (on the VPN): if it isn't, `init` gives up after 30 seconds and can be run again. The devcontainer runs it when it is created, once you have signed in.

`just secrets pull [name...]` pulls the secrets alone.

### Save a secret to Bitwarden

Push a secret after changing it, or after generating it for a new cluster. It is created if Bitwarden doesn't have it yet.

```sh
just secrets push talos
```

## Apps

### Add or change an app

An app is a directory of `apps/` with an `app.ts`: `app` says what to deploy, and `network` says what it may talk to.

```ts
// apps/descheduler/app.ts
export const app: AppFunction = (h) => {
  h.helm(
    "https://kubernetes-sigs.github.io/descheduler/descheduler?version=0.36.0",
    { values: { kind: "Deployment" } },
  );
  h.namespace();
  h.vpa({ kind: "Deployment", name: "descheduler" });
};
```

Render every app into `out/apps`, the layout Flux reads from the manifests repository, and see what it would change in the cluster:

```sh
just build
flux diff kustomization descheduler --path out/apps/descheduler
```

### Change how Flux deploys an app

Every app gets a Flux Kustomization. Export `flux` from `app.ts` to make it wait for other apps, or set it to `false` to disable the app, which deletes what Flux deployed.

```ts
export const flux = { dependsOn: ["cert-manager"] };
```

### Allow a connection between apps

Network policies come from each app's `export const network`: declare the app's pods as a subject, then each `to` or `from` line allows a connection at both ends.

```ts
// apps/descheduler/app.ts
export const network: NetworkFunction = (n) => {
  const descheduler = n.subject(
    "descheduler",
    pod("descheduler", "descheduler"),
  );

  descheduler.to(n.kubeApiServer, tcp(6443));
  n.host.to(descheduler, tcp(10258));
};
```

To reach another app's pods, refer to the subject it declares with `n.ref`. The app that starts the connection declares it.

```ts
// apps/mosquitto/app.ts
n.subject("mosquitto", pod("mosquitto", "mosquitto"));

// apps/home-assistant/app.ts
homeAssistant.to(n.ref("mosquitto"), tcp(1883));
```

## Operations

### Troubleshoot network policies

Hubble shows what Cilium allows and drops. Flows set up while a pod starts only show if you restart the pod.

```sh
hubble observe --server tls://flows.fiola.dev --verdict DROPPED --from-pod my-namespace/my-pod
hubble observe --server tls://flows.fiola.dev --to-namespace my-namespace --follow --print-policy-names
```

### Restore a volume from backup

volsync backs volumes up to cloud storage. To restore, annotate the `PersistentVolumeClaim`. `""` restores the latest snapshot, a number restores that many snapshots ago, and an RFC 3339 time restores the snapshot at that time.

```yaml
metadata:
  annotations:
    pvc-restore.homelab-images.benfiola.com/backup: ""
```

### Update a dependency

Renovate opens a pull request only once you tick its box in the Dependency Dashboard issue. The pinned tools also carry download hashes Renovate can't compute:

```sh
just pins set kubectl <version>    # set a version, and refresh its hashes
just pins refresh                  # refresh every hash, after Renovate bumps a version
just pins check                    # fail if any hash is out of date
```

### Add a tool to the dev shell

- **Any version will do** (`k9s`, `vim`, ...): add it to `packages` in `flake.nix` (find its name on [search.nixos.org](https://search.nixos.org/packages), `unstable` channel).
- **A specific version is needed** (`kubectl`, `talosctl`, ...): pin it in `pins.json` (see above).

To see which version a nixpkgs tool gets:

```sh
nix eval --inputs-from . --raw nixpkgs#vim.version    # locked nixpkgs
nix develop -c vim --version                          # dev shell
```

Update all tools in the nix flake:

```sh
nix flake update
```

## Cluster

### Build a new cluster

Image the nodes, apply their configuration, bootstrap the control plane, then bring up the apps. The cluster's secrets bundle is generated once: save it to Bitwarden before relying on it, as losing it means losing access to the cluster.

```sh
just secrets login                                       # first, so ~/.homelab exists
talosctl gen secrets --output-file ~/.homelab/talos.yaml
just secrets push talos
just talos images <version>                  # installer images; write the ISO to a USB drive and boot each node
just talos client-config > ~/.talos/config
just talos apply --insecure                 # every enabled node, still in maintenance mode
just talos ctl -n samoyed bootstrap         # waits until a CNI is deployed
just talos ctl -n samoyed kubeconfig
just build
just bootstrap                      # crds, network policies, cilium, flux
```

Flux is bootstrapped with the GitHub token in `~/.homelab/flux-git-token` unless `FLUX_GIT_TOKEN` is set. External Secrets is bootstrapped with the Bitwarden token `~/.homelab/eso-bws-token` unless `ESO_BWS_TOKEN` is set. `just bootstrap --dry-run` prints the steps without running them, and `--from <stage>` resumes after a failure.

### Add a node

Define the node in `talos/nodes.yaml`, and give it a DHCP reservation and a DNS record as a host in `network/network.yaml`. Boot it from the installer image until it is in maintenance mode, then apply its configuration. `--insecure` only works the first time.

```sh
just talos apply new-node --insecure
just talos ctl -n new-node dashboard
kubectl get nodes
```

### Reset a node

This removes all data and configuration. Talos drains the node first, which can't work when every control-plane node is reset: add `--graceful=false` then.

```sh
just talos ctl -n node-1,node-2 reset --reboot --system-labels-to-wipe=EPHEMERAL,STATE
```

### Change cluster or node configuration

Edit `talos/`, check what a node would get, and apply it to the nodes you name (or all enabled ones). This does not upgrade Talos or Kubernetes.

```sh
just talos config samoyed
just talos apply samoyed
```

### Upgrade Kubernetes

Set `kubernetes` in `talos/cluster.yaml`, and keep `kubectl` in step (a test checks they agree).

```sh
just pins set kubectl <version>
just talos ctl -n samoyed upgrade-k8s
```

### Upgrade Talos

Register the new version's images, put each profile's installer image in `talos/profiles/`, and pin `talosctl`.

```sh
just talos images <version>
just pins set talosctl <version>
```

Then upgrade one node at a time, control plane first. Replicated volumes (two replicas and a tiebreaker) survive one node down but not two, so before each node, check that every volume is in sync, and drain it so nothing is using storage on it when it reboots. Volumes on the `standard` storage class have one replica: their pods wait for the node to return. Cancelling the upgrade command does not cancel the upgrade.

```sh
linstor() { kubectl -n piraeus-operator exec deploy/linstor-controller -- linstor "$@"; }

linstor resource list    # every volume UpToDate, none SyncTarget or Outdated
kubectl drain chihuahua --ignore-daemonsets --delete-emptydir-data
just talos ctl -n chihuahua upgrade --wait    # the image comes from the node's profile
kubectl uncordon chihuahua
linstor resource list    # repeat until every volume is in sync, then do the next node
```

## Network

The router, access points and switches take configuration from scratch, not as changes: factory-reset a device, then apply. Edit `network/network.yaml` (VLANs, hosts, WireGuard, devices) and `network/scripts/`.

### Render configuration

Write every device's file (or only those you name) to `out/network`, replacing what is there. The secrets come from `~/.homelab/network.yaml`, and end up in the files, so `out/` is git-ignored.

```sh
just network list
just network render
just network render router.rsc
```

### Add a host

A host is a DHCP reservation, and optionally a DNS record, firewall allowances and a BGP peer. Add it under `hosts:` in `network/network.yaml`, then apply the router.

```yaml
- { vlan: iot, ip: 15, name: new-camera, mac: AA:BB:CC:DD:EE:FF, dns: true }
```

### Apply to the router

The router is reset to the script. Add `--dry-run` to see what would be run, and omit `--reset` to only copy the script. Afterwards, log in as `admin` and set a password.

```sh
just network apply router.rsc --address <router> --reset
```

### Apply to an access point

Factory-reset the access point (`firstboot && reboot`) and connect to one of its LAN ports: it answers at `192.168.1.1` as `root`, with no password. Afterwards, set the admin password in the web UI and reboot it.

```sh
just network apply office.ap.sh --address 192.168.1.1
```

### Apply to a switch

Factory-reset the switch (hold the reset button while powering it on), set your interface to `192.168.1.2/24`, and apply. Only what differs is written. `dump` prints a switch's current configuration.

```sh
just network apply core.switch.yaml --address 192.168.1.1 --dry-run
just network apply core.switch.yaml --address 192.168.1.1
just network dump <switch>
```

### Add a WireGuard client

Add the device under `clients:` with its address in each interface, apply the router so it has the peer, and import the rendered file into the client.

```yaml
new-phone: { personal: 6 }
```

```sh
just network render wireguard.new-phone.conf
```

## Development

### Type check and test

The tools in `tools/` and every `apps/*/app.ts` are TypeScript that node runs directly. `just check` typechecks them all, then runs the tests. Run it after changing either.

```sh
just check
```
