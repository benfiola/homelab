#!/usr/bin/env bash
set -euo pipefail
set -x

# configure nix and activate devshell
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
nix-shell -p git --run "git config --system --add safe.directory '*'"
nix print-dev-env . | tee /etc/nix-devshell.sh >/dev/null
echo '. /etc/nix-devshell.sh' | tee -a /etc/bash.bashrc >/dev/null
. /etc/nix-devshell.sh

# install tool dependencies
npm ci --prefix tools

# secrets and client configuration, once this machine has signed in to Bitwarden (`just secrets login`)
just init || echo "not initialised: fix the above (\`just secrets login\` if not signed in), then run \`just init\`"
