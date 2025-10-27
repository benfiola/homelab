#/bin/sh
set -e

apt -y update
DEBIAN_FRONTEND=noninteractive apt -y install vim

BIN=/usr/local/bin make install-tools

npm install
npm link tsx
npm link