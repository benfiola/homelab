#!/bin/bash
set -e

echo "Waiting for game data download to complete..."
while [ ! -f /game-data/data-version ]; do
  echo "Waiting for game data to be ready..."
  sleep 5
done

# Check if migrations already ran (use marker file)
if [ -f /logs/.db-migrated ]; then
  echo "Database migrations already completed, skipping..."
else
  echo "Running database migrations with dbimport..."
  /azerothcore/env/dist/bin/dbimport
  echo "Database migrations complete"
  mkdir -p /logs
  touch /logs/.db-migrated
fi
