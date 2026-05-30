#/bin/sh
set -e

apt -y update
DEBIAN_FRONTEND=noninteractive apt -y install vim

make install-tools
make install-docs
make install-project
gcloud auth login
bw login
bw lock
homelab generate-client-config
homelab talosctl -n a kubeconfig