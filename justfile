set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

# install tool dependencies (run once, or after tools/package-lock.json changes)
install:
    npm ci --prefix tools

# typecheck and test everything in tools/
check:
    npm run --prefix tools check

# render apps/ into ./out (the layout flux reads from the manifests repo): just build --out out
build *args:
    node tools/build.ts {{ args }}

# compare a render against the reference manifests (golden master): just parity ./golden/manifests ./out --app cert-manager
parity expected actual *args:
    node tools/parity.ts {{ expected }} {{ actual }} {{ args }}

# the cluster's nodes (see tools/talos.ts): just talos config samoyed
talos *args:
    node tools/talos.ts {{ args }}

# the network devices (see tools/network.ts): just network render
network *args:
    node tools/network.ts {{ args }}

# the secrets this machine holds (see tools/secrets.ts): just secrets pull
secrets *args:
    node tools/secrets.ts {{ args }}

# ready this machine for the cluster: pull secrets, write the talos and kube config (see tools/init.ts)
init *args:
    node tools/init.ts {{ args }}

# first-boot sequence for a new cluster (see bootstrap.yaml): just bootstrap --dry-run
bootstrap *args:
    node tools/bootstrap.ts {{ args }}

# the pinned tools (see tools/pins.ts): just pins set kubectl 1.36.6
pins *args:
    node tools/pins.ts {{ args }}
