#!/bin/bash
set -e
echo "initializing data volume"
mkdir -p /data/usenet/incomplete/movies
mkdir -p /data/usenet/incomplete/tv
mkdir -p /data/usenet/complete/movies
mkdir -p /data/usenet/complete/tv
mkdir -p /data/torrents/movies
mkdir -p /data/torrents/tv
mkdir -p /data/media/movies
mkdir -p /data/media/tv
touch /data/.initialized
echo "data volume initialized"
sleep infinity
