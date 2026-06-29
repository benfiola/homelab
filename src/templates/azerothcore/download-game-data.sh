#!/bin/bash
set -e

if [ -z "$GAME_DATA_URL" ]; then
  echo "Error: GAME_DATA_URL environment variable is not set"
  exit 1
fi

if [ -f /game-data/data-version ]; then
  echo "Game data already downloaded, checking version..."
  source /game-data/data-version
  if [ "$INSTALLED_VERSION" = "v19" ]; then
    echo "Data v19 already installed."
    exit 0
  fi
fi

echo "Starting game data download from: $GAME_DATA_URL"
mkdir -p /game-data

echo "Downloading game data..."
curl -L "$GAME_DATA_URL" > /tmp/data.zip \
  && echo "Extracting data..." \
  && unzip -q -o /tmp/data.zip -d /game-data/ \
  && rm /tmp/data.zip \
  && echo 'INSTALLED_VERSION=v19' > /game-data/data-version

echo "Game data download complete"
