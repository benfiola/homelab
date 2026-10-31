# TODO

Hand-off notes for continuing the homelab redesign on another machine. Delete this file once the work is done.

## What this is

The repository is being rebuilt from a clean slate on the `refactor` branch. The old repository (`main`, commit `fabf050`) is what is deployed today and **must keep working untouched** until a deliberate cutover. The new code renders to the same manifests and is proven against them (see [Parity](#parity)).

Nothing in the new tooling has been applied to the live cluster, router, access points or switch yet.

## Getting started on a new machine

1. Open the repo in the devcontainer (it enters the nix dev shell), or run `nix develop`.
2. `just install` - install `tools/` dependencies.
3. `just secrets login` - paste the Bitwarden Secrets Manager access token. It is stored in `~/.homelab/bws-token`; the devcontainer keeps `~/.homelab` in the `homelab-secrets` named volume.
4. `just init` - pulls the secrets to `~/.homelab`, then writes `~/.talos/config` and `~/.kube/config` (the kubeconfig only if the cluster is reachable, i.e. on the VPN). `post-create.sh` runs it on devcontainer creation once step 3 has been done.
5. `just check` - typecheck and run the tests (423 pass at the time of writing).

`golden/`, `out/` and `.cache/` are git-ignored, so a new machine does **not** have them. `just build` recreates `out/`; `golden/` needs rebuilding (see below).

## What has been built

### Render pipeline (`tools/build.ts`, `tools/lib/`)

- Each app is `apps/<app>/app.ts`, exporting `app` and optionally `network` (network policy) and `flux` (`false`, or `{ dependsOn, force }`).
- `just build` renders `apps/` into `out/apps/<app>/{manifest.yaml,kustomization.yaml}` plus a generated `crds` app. 54 apps build, 0 failures.
- Vendored charts and downloads are cached in `.cache/` (ignored). Pinned CLI tools are in `pins.json` (`just pins set|refresh|check`).
- `bootstrap.yaml` + `just bootstrap` is the first-boot sequence for a new cluster. Vault initialisation is still manual.

### Parity

- `golden/manifests` is the rendered output of the old pipeline - what is deployed. `just parity ./golden/manifests ./out` compares the new render with it: **56 apps compared, 56 ok, 0 differences**.
- Accepted differences are listed with reasons in `parity.allow.yaml` (cilium checksum and an empty helm arg, and `flux-bootstrap` no longer being an app). Stale allowances are an error.
- `golden/source` is a checkout of the old repo (`main` @ `fabf050`). The exact command that generated `golden/manifests` is not recorded here; the old publish workflow shows the process: `git show fb8b72c:.github/workflows/publish.yaml`.

### Talos (`tools/talos.ts`, `talos/`)

- `talos/cluster.yaml`, `talos/nodes.yaml` (each node has a `profile:`), `talos/profiles/{axp,tc}.yaml`, `talos/config/`.
- `just talos config|apply|client-config|images|ctl`. `ctl` passes everything through to `talosctl` (so `just talos ctl --help` is talosctl's help), accepts node names, and fills in the image for `upgrade` and the version for `upgrade-k8s`.
- Secrets bundle: `--secrets`, else `TALOS_SECRETS`, else `~/.homelab/talos.yaml`.

### Network (`tools/network.ts`, `network/`)

- `network/network.yaml` is the single description: domain, resolver, VLANs (VLAN 8 is `family`), gateways, WireGuard interfaces and clients, hosts, and devices (each with a `profile`: `routeros`, `openwrt` or `swos`).
- Device templates are in `network/scripts/` (`router.rsc`, `ap.sh`, `switch.yaml`), with strict `{{ }}` substitution and generated blocks. The SwOS switch template has three `---`-separated parts (switch, port, VLAN).
- `just network list|render|apply|dump`. Apply for a router is scp plus an optional `--reset`; for access points it is ssh with the script on stdin; for switches it is the SwOS HTTP client (diff, write, read-back verification). `dump` reads a switch's current configuration.
- Equivalence with the old network output was verified when the refactor was done.
- Secrets: `--secrets`, else `NETWORK_SECRETS`, else `~/.homelab/network.yaml`.

### Secrets (`tools/secrets.ts`, `tools/lib/secrets/local.ts`)

- Secrets live in Bitwarden Secrets Manager (project UUID is a constant in `secrets.ts`; override with `--project` or `BWS_PROJECT_ID`). Four secrets, `talos`, `network`, `flux` (the GitHub token that `just bootstrap` uses) and `apps`, each stored whole as YAML. The old `vault` secret is not handled: it goes away with the ESO migration.
- `just secrets login | pull [name...] | push <name> [file]`. The local cache is `~/.homelab` (directory 700, files 600). The tools refuse to read a secrets file readable by group or others. `HOMELAB_DIR` moves the directory.
- The devcontainer mounts the `homelab-secrets` volume at `/root/.homelab` and `post-create.sh` runs `just init` (`tools/init.ts`), which pulls the secrets and builds the talos and kube configs, tolerating an unreachable cluster.

### CLI conventions

- `commander` for argument parsing and `zod` for validating YAML (`tools/lib/schema.ts`, `tools/lib/cli.ts`); aligned table output via `tools/lib/table.ts`.

### Docs

- `README.md` is an admin primer: setup, secrets, apps (including Flux options and network policies), operations (troubleshooting, volume restore, dependency updates), cluster (build, nodes, upgrades including the DRBD/LINSTOR-safe procedure) and network.

## What is left

### Decisions and cleanups

- [ ] The Vault seeding (from the `apps` secrets) is manual and goes away with the ESO migration.
- [ ] `secrets push` passes the secret value to `bws` as an argument, which is visible in the process list while it runs. Fine on a single-user container; revisit if that changes.

### Things I could not verify (need the real machines or cluster)

- [ ] **`post-create.sh` and the `homelab-secrets` volume** have only been syntax-checked, not run in a real devcontainer rebuild. Rebuild once and confirm the volume persists across recreates.
- [ ] **Real Bitwarden**: `secrets login/pull/push` were tested against a stub `bws`, not the real service. Check them with the real token, and confirm both secrets are present in the project (push them if not).
- [ ] **DRBD / LINSTOR / Piraeus upgrade procedure** (README, "Upgrade Talos" and "Upgrade Kubernetes"): verify the commands against the live cluster - the LINSTOR controller deployment name, the `linstor resource list` columns used for the sync gate, and how `upgrade-k8s` behaves with replicated volumes. Also confirm the assumed automatic tiebreaker for the 2-replica `replicated` storage class.
- [ ] **Network applies**: run `just network apply` with `--dry-run` where available, then for real, against the AP, switch and router. Start with a switch (`just network dump <address>` first, to compare). Routers with `--reset` wipe the device, so have console access.
- [ ] `hubble --server tls://flows.fiola.dev` (README, network-policy troubleshooting) and `flux diff kustomization <app> --path out/apps/<app>` have not been run against the cluster.

### Cutover (in progress)

The plan: the old pipeline keeps writing `apps/` of `homelab-manifests` (`main`) until the very end. The new pipeline (`.github/workflows/publish.yaml`, run by pushes to this `refactor` branch) writes the same apps to `refactor/` beside it, and an app moves by hand-editing `apps/flux/manifest.yaml` in the manifests repo, so that its Kustomization `path` is `./refactor/<app>` instead of `./apps/<app>`. Once every app has moved, the new workflow is switched to write `apps/` and this branch is merged into `main`, which cuts over everything at once.

- [x] **Publishing workflow.** Written, with the push enabled. Not yet seen to run: check the first run, and that `HOMELAB_MANIFESTS_GIT_TOKEN` can push to `main`.
- [x] **`apps/` and `refactor/` agree** (checked against `golden/manifests` at the time alertmanager moved): 55 of 56 apps identical by `just parity` (only the alertmanager Kustomization path differs, as intended; `flux-bootstrap` has no `refactor/` copy). `kustomization.yaml` has the same content everywhere. Object order within a manifest differs in 30 apps (same objects, `order: fifo`); this is expected to be harmless, as Flux applies in stages, but it is unconfirmed. Re-check with parity just before the final merge.
- [ ] **While migrating, nothing may land on `main`.** The old `publish` workflow deletes and regenerates `apps/` on every push to `main`, which would undo the hand edits to `apps/flux` (Renovate PRs included). Disabling the old workflow in the Actions UI is optional insurance.
- [ ] **Move apps in tiers**, a tier per commit to `apps/flux/manifest.yaml`. Before each tier, `flux diff kustomization <app> --path refactor/<app>` for each app must be empty (never run yet); afterwards watch `flux get kustomizations`. To undo, point the path back.
  1. Stateless leaves: alertmanager (done), dynamic-dns, kokoro-fastapi, wyoming-openai, wyoming-whisper, mdns-reflector, prometheus-node-exporter, kube-state-metrics, reloader, descheduler, bucket-sync, pvc-restore, intel-device-plugins, multus-network, volume-snapshot-api, gateway-api.
  2. Observability and add-ons: prometheus, prometheus-operator, grafana, grafana-operator, monitoring-config, alloy, metrics-server, vertical-pod-autoscaler, node-feature-discovery, nvidia-gpu-operator, external-dns.
  3. Stateful apps: home-assistant, mosquitto, music-assistant, postfix, llama-cpp, frigate, mediarr, loki.
  4. Operators, webhooks and storage (a mistake breaks API calls or volume mounts): cert-manager, envoy-gateway, gateway, intel-device-plugins-operator, piraeus-operator, linstor, storage-class, csi-driver-nfs, external-snapshotter, volsync, garage-operator, garage, vault-secrets-operator, vault-push-secrets, vault, multus.
  5. Foundation, one at a time: cilium (the agents roll once: the ConfigMap checksum differs, see `parity.allow.yaml`), network-policy (88 policies), crds (122 CRDs: a wrong prune would delete custom resources).
  - There is no `dependsOn` between Kustomizations, so the order is by blast radius, not dependencies. Each app has its own Kustomization with `prune: true`, but identical objects mean nothing is pruned when a path changes.
- [ ] **The switch.** `publish.yaml` is ready on this branch (it writes `apps/`, on pushes to `main`). Remaining: re-run `just parity` against the deployed `apps/` and check `flux get kustomizations`; merge this branch into `main`. The first run replaces `apps/`, including a generated `apps/flux` that points every Kustomization back at `./apps/<app>`; the content there is identical to `refactor/`. Keep `refactor/` until every Kustomization is Ready on `./apps/`, then delete it from the manifests repo, by hand: nothing maintains it any more.
- [ ] Note the Flux behaviour: setting `flux = false` on an app removes its Kustomization, which prunes what it deployed. That is the intended "disable" semantics. Do not use it on a deployed app unless you mean to remove it.
- [ ] Swap the alpine image used by some apps for the toolbox image (separate, later).
- [ ] The old workflows (`publish`, `refresh-assets`) are gone from this branch, so merging retires them. Check `renovate.json` still fits (it points at `just pins refresh`).

### Vault to External Secrets Operator (separate project, after cutover)

- [ ] Replace the Vault secrets operator / push-secrets apps (`vault`, `vault-push-secrets`, `vault-secrets-operator`) with ESO, possibly with the Bitwarden provider. Deliberately deferred so the two migrations do not overlap.

### Optional ideas (not decided)

- [ ] `just talos upgrade` that automates the one-node-at-a-time upgrade with the LINSTOR sync gate, instead of README steps.
- [ ] An `enabled` flag for Flux apps, separate from `flux = false` (which prunes).
- [ ] Handle `flux` and `apps` secrets in `just secrets`.

## Decisions already made (do not reopen without a reason)

- `network.yaml`: VLAN 8 is named `family`; things used in one place live in the template, not in `network.yaml`; devices (all kinds) are unified under `profile`, and the word "profile" is used for Talos too.
- No WireGuard `persistent-keepalive` on any peer.
- Secrets are stored whole in Bitwarden, cached in `~/.homelab`, and not split into more projects. There is no rotation runbook: a leak means a full reset.
- `.kube` and `.talos` are not volumes; they can be regenerated.
- Flux "everything depends on CRDs" is not needed: eventual reconciliation covers it.
- `flux = false` pruning behaviour stays as it has always worked.
- Cutover is a single switch, not app by app in the writer: the new pipeline publishes to `refactor/` of `main` while apps are moved by hand-editing `apps/flux`, then it takes over `apps/` in one merge.
- README stays a short primer: a sentence or two plus the commands; no tool lists beyond `just` and nix.
