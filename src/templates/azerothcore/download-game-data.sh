#!/bin/bash
set -e

# Check if download already completed
if [ -f /game-data/data-version ]; then
  echo "Game data already downloaded, checking version..."
  source /game-data/data-version
  if [ "$INSTALLED_VERSION" = "v19" ]; then
    echo "Data v19 already installed."
    exit 0
  fi
fi

echo "Starting game data download..."
mkdir -p /game-data

# Download from the official AzerothCore client-data repository
echo "Downloading data.zip from github..."
curl -L https://github.com/wowgaming/client-data/releases/download/v19/data.zip > /tmp/data.zip \
  && echo "Extracting data..." \
  && unzip -q -o /tmp/data.zip -d /game-data/ \
  && rm /tmp/data.zip \
  && echo 'INSTALLED_VERSION=v19' > /game-data/data-version

echo "Game data download complete"
