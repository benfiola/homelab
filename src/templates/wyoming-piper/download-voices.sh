#!/bin/bash
set -e

ASSET_SERVER="${1}"
if [ -z "${ASSET_SERVER}" ]; then
  echo "error: ASSET_SERVER URL required as first argument" 1>&2
  exit 1
fi

DATA_DIR="${2:-.}"
if [ -z "${DATA_DIR}" ] || [ "${DATA_DIR}" = "." ]; then
  echo "error: DATA_DIR required as second argument" 1>&2
  exit 1
fi

shift 2
if [ $# -eq 0 ]; then
  echo "error: at least one file to download required" 1>&2
  exit 1
fi

echo "Downloading from ${ASSET_SERVER} to ${DATA_DIR}..."

for file in "$@"; do
  dest="${DATA_DIR}/${file}"

  if [ -f "${dest}" ]; then
    echo "  ${file}: already exists, skipping"
    continue
  fi

  echo "  Downloading ${file}..."
  curl -fSL "${ASSET_SERVER}/${file}" -o "${dest}"
done

echo "Download complete"
