#!/bin/sh
set -e

gcloud auth application-default login --launch-browser
homelab env download
homelab nodes config download
