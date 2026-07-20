#!/usr/bin/env bash
set -e

if [[ -z "${JELLYFIN_TAG:-}" ]]; then
    echo "JELLYFIN_TAG is not set, aborting" >&2
    exit 1
fi

if [[ -n "${sonarr_eventtype:-}" ]]; then
    EVENT_TYPE="$sonarr_eventtype"
    FILE_PATH="${sonarr_episodefile_path:-}"
    ROOT_TAG="episodedetails"
elif [[ -n "${radarr_eventtype:-}" ]]; then
    EVENT_TYPE="$radarr_eventtype"
    FILE_PATH="${radarr_moviefile_path:-}"
    ROOT_TAG="movie"
else
    echo "Neither sonarr_* nor radarr_* variables present, exiting" >&2
    exit 0
fi

if [[ "$EVENT_TYPE" != "Download" ]]; then
    exit 0
fi

if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
    echo "No valid media file at '$FILE_PATH', skipping" >&2
    exit 0
fi

NFO_PATH="${FILE_PATH%.*}.nfo"

cat > "$NFO_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<${ROOT_TAG}>
  <tag>${NFO_TAG_VALUE}</tag>
</${ROOT_TAG}>
EOF
