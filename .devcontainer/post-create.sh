#!/usr/bin/env bash
set -euo pipefail

. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

nix-shell -p git --run "git config --system --add safe.directory '*'"

# /etc/nix-devshell.sh is written by ./post-start.sh
echo '. /etc/nix-devshell.sh' | tee -a /etc/bash.bashrc >/dev/null

# install tool dependencies (node comes from the devshell)
nix develop . --command npm ci --prefix tools

# secrets and client configuration, once this machine has signed in to Bitwarden (`just secrets login`)
nix develop . --command bash -c 'just init || echo "not initialised: fix the above (\`just secrets login\` if not signed in), then run \`just init\`"'
