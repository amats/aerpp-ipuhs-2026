#!/usr/bin/env bash
set -euo pipefail

privilegedCommand=()
if (( EUID != 0 )); then
  privilegedCommand=(sudo)
fi

# Register Google's signed Debian repository for both ARM64 and AMD64 containers.
"${privilegedCommand[@]}" install -d -m 0755 /usr/share/keyrings
curl --fail --silent --show-error https://packages.cloud.google.com/apt/doc/apt-key.gpg \
  | "${privilegedCommand[@]}" gpg --dearmor --yes -o /usr/share/keyrings/google-cloud-cli.gpg
printf '%s\n' 'deb [signed-by=/usr/share/keyrings/google-cloud-cli.gpg] https://packages.cloud.google.com/apt cloud-sdk main' \
  | "${privilegedCommand[@]}" tee /etc/apt/sources.list.d/google-cloud-cli.list > /dev/null
