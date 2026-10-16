#!/usr/bin/env bash
set -euo pipefail
umask 077
BUNDLE_DIRECTORY="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_ENVIRONMENT="$(cat "$BUNDLE_DIRECTORY/config/profile.txt")"
case "$BUNDLE_ENVIRONMENT" in test|production) ;; *) echo "Invalid bundle environment" >&2; exit 1 ;; esac
INSTALL_DIRECTORY="${1:-$HOME/aerpp}"
if [[ "$#" -gt 1 || "$INSTALL_DIRECTORY" != /* ]]; then
  echo 'Usage: bash install.sh [/absolute/install/directory]' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo 'Docker Desktopを起動してから、もう一度実行してください。' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Composeが必要です。Docker Desktopの導入状態を確認してください。' >&2
  exit 1
fi
bash "$BUNDLE_DIRECTORY/operate.sh" install "$INSTALL_DIRECTORY" --maintenance
printf 'インストールが完了しました。起動: bash "%s/operate.sh" start\n' "$INSTALL_DIRECTORY"
echo 'ZIPの展開フォルダは削除できます。'
