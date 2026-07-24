#!/bin/sh
table=51820
interface=tun0
mss=1300

while true; do
  current="$(ip route show table "${table}" 2>/dev/null | grep '^default')"
  if ! echo "${current}" | grep -q "advmss ${mss}"; then
    if ip route change default dev "${interface}" advmss "${mss}" table "${table}" 2>/dev/null; then
      echo "$(date '+%Y-%m-%dT%H:%M:%S%z') applied advmss ${mss} to table ${table} route (was: ${current:-<none>})"
    fi
  fi
  sleep 5
done
