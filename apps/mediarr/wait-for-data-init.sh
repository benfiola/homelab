#!/bin/bash
set -e
file=/data/.initialized
max_wait=30
elapsed=0
while [ ! -f "${file}" ]; do
  if [ $elapsed -ge ${max_wait} ]; then
    echo "${file}: timeout after ${elapsed}s"
    exit 1
  fi
  echo "[${elapsed}s] ${file}: not found"
  sleep 1
  elapsed=$((elapsed + 1))
done
echo "${file}: found"
