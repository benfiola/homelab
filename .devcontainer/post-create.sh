#/bin/bash
set -euo pipefail

echo 'export DEBIAN_FRONTEND=noninteractive' >> ~/.bashrc
export DEBIAN_FRONTEND=noninteractive

apt -y update
apt -y install vim

make install-tools
make install-docs
make install-project

# Setup bws
read -sp "Enter Bitwarden Secrets Manager access token: " BWS_ACCESS_TOKEN
mkdir -p ~/.config/bws
echo "$BWS_ACCESS_TOKEN" > ~/.config/bws/access-token
chmod 600 ~/.config/bws/access-token
export BWS_ACCESS_TOKEN
echo 'export BWS_ACCESS_TOKEN=$(cat ~/.config/bws/access-token)' >> ~/.bashrc

homelab pull-secrets
homelab generate-client-config
homelab talosctl -n d kubeconfig