#!/bin/bash
set -e

if [ "$#" -eq 0 ] || [ "$(($# % 2))" -ne 0 ]; then
  echo "error: expected pairs of <url> <dest-path> arguments" 1>&2
  exit 1
fi

declare -A keep
declare -A dirs
args=("$@")
i=0
while [ "${i}" -lt "${#args[@]}" ]; do
  dest="${args[$((i + 1))]}"
  keep["${dest}"]=1
  keep["${dest}.url"]=1
  dirs["$(dirname "${dest}")"]=1
  i=$((i + 2))
done

for dir in "${!dirs[@]}"; do
  for file in "${dir}"/*; do
    [ -f "${file}" ] || continue
    if [ -z "${keep[${file}]}" ]; then
      echo "${file}: removing unrecognized file"
      rm -f "${file}"
    fi
  done
done

while [ "$#" -gt 0 ]; do
  url="${1}"
  dest="${2}"
  shift 2

  urlFile="${dest}.url"
  if [ -f "${dest}" ] && [ -f "${urlFile}" ] && [ "$(cat "${urlFile}")" = "${url}" ]; then
    echo "${dest}: already up to date, skipping"
    continue
  fi

  echo "${dest}: downloading from ${url}"
  mkdir -p "$(dirname "${dest}")"
  curl -fSL --retry 3 --retry-delay 5 -o "${dest}.tmp" "${url}"
  mv "${dest}.tmp" "${dest}"
  echo "${url}" >"${urlFile}"
  echo "${dest}: done"
done
