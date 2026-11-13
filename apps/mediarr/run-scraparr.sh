#!/bin/sh
keys=/config/api-keys.yaml
interval=10

pid=
trap 'kill "${pid}" 2>/dev/null; exit 0' TERM INT

nap() {
  sleep "${interval}" &
  wait $!
}

export_config() {
  for entry in sonarr:8989 radarr:7878 prowlarr:9696 sabnzbd:8080 seerr:5055 jellyfin:8096; do
    name="${entry%%:*}"
    port="${entry##*:}"
    key="$(sed -n "s/^${name}: *//p" "${keys}" | tr -d "\"' \r")"
    if [ -n "${key}" ]; then
      upper="$(echo "${name}" | tr 'a-z' 'A-Z')"
      export "${upper}_URL=http://${name}:${port}" "${upper}_API_KEY=${key}"
    fi
  done
}

while true; do
  until [ -s "${keys}" ]; do
    echo "${keys}: not found"
    nap
  done

  checksum="$(cksum <"${keys}")"
  (
    export_config
    exec python -um scraparr.scraparr
  ) &
  pid=$!

  while kill -0 "${pid}" 2>/dev/null && [ "$(cksum <"${keys}" 2>/dev/null)" = "${checksum}" ]; do
    nap
  done

  if kill -0 "${pid}" 2>/dev/null; then
    echo "${keys}: changed, restarting"
    kill "${pid}"
  fi
  wait "${pid}" 2>/dev/null
  nap
done
