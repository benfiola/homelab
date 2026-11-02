#!/usr/bin/env bash
set -euo pipefail

# reconfigure nix and activate devshell
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
nix print-dev-env . | tee /etc/nix-devshell.sh >/dev/null
. /etc/nix-devshell.sh
