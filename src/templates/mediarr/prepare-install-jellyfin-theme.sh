#!/bin/sh
set -e
url="https://raw.githubusercontent.com/AumGupta/abyss-jellyfin/refs/tags/v1.2.1/scripts/docker/abyss-spotlight.sh"
curl -fsSL -o /custom-cont-init.d/install-theme.sh "${url}"
chmod +x /custom-cont-init.d/install-theme.sh
