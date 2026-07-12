#!/bin/sh
set -e
direction="${1}"
if [ "${direction}" = "up" ]; then
  port="${2}"
  interface="${3}"
  payload=$(printf '{"listen_port":%s,"current_network_interface":"%s","random_port":false,"upnp":false}' "${port}" "${interface}")
else
  payload='{"listen_port":0,"current_network_interface":"lo"}'
fi
wget -O- -nv --retry-connrefused --post-data "json=${payload}" http://127.0.0.1:8080/api/v2/app/setPreferences
