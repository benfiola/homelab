#!/bin/bash
set -e

if [ -z "$GAME_DATA_URL" ]; then
  echo "Error: GAME_DATA_URL environment variable is not set"
  exit 1
fi

if [ -f /data/data-version ]; then
  echo "Game data already downloaded, checking version..."
  . /data/data-version
  if [ "$INSTALLED_VERSION" = "v19" ]; then
    echo "Data v19 already installed."
    exit 0
  fi
fi

echo "Starting game data download from: $GAME_DATA_URL"
mkdir -p /data

echo "Downloading game data..."
curl -o /tmp/data.zip -fsSL "$GAME_DATA_URL"

echo "Extracting data..."
bsdtar -xmf /tmp/data.zip -C /data/
rm /tmp/data.zip
echo 'INSTALLED_VERSION=v19' > /data/data-version

echo "Game data download complete"
