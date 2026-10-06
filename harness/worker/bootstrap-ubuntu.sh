#!/usr/bin/env bash
set -euo pipefail

# Build this into a reusable Sandbox image or snapshot. Do not run it for each film.
HYPERFRAMES_VERSION="${HYPERFRAMES_VERSION:-0.8.80}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo 'This bootstrap requires Ubuntu with apt-get.' >&2
  exit 2
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg libnspr4 libnss3
npm install --global "hyperframes@${HYPERFRAMES_VERSION}"
hyperframes browser ensure

ffmpeg -version | head -1
ffprobe -version | head -1
hyperframes --version
