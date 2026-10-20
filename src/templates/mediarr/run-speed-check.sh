#!/bin/sh
# downloads (up to) a fixed number of bytes through the vpn within a time budget.
# exits non-zero when the vpn is too slow - used as a liveness probe so that a
# slow vpn server results in a gluetun restart (and a new server).
url="${SPEED_CHECK_URL:-https://proof.ovh.net/files/100Mb.dat}"
bytes="${SPEED_CHECK_BYTES:-20971520}"
seconds="${SPEED_CHECK_SECONDS:-10}"

received="$(timeout "${seconds}" wget -q -O - "${url}" 2>/dev/null | head -c "${bytes}" | wc -c)"
if [ "${received}" -lt "${bytes}" ]; then
  echo "vpn too slow: received ${received}/${bytes} bytes in ${seconds}s"
  exit 1
fi
echo "vpn ok: received ${bytes} bytes within ${seconds}s"
