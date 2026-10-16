#!/usr/bin/env bash
# Prepare browser tools, locked dependencies, and browser tests.
set -euo pipefail

repoRoot="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repoRoot"

pnpm install --frozen-lockfile
# Use Playwright's versioned Chromium for both manual checks and E2E tests.
pnpm run test:e2e:install --with-deps

# Enable pnpm completion in interactive Bash sessions.
completion_file="$(mktemp "$HOME/.pnpm-completion.XXXXXX")"
trap 'rm -f -- "$completion_file"' EXIT
pnpm completion bash > "$completion_file"
mv -fT -- "$completion_file" "$HOME/.pnpm-completion.bash"
if ! grep -Fqx 'source ~/.pnpm-completion.bash' "$HOME/.bashrc"; then
  echo 'source ~/.pnpm-completion.bash' >> "$HOME/.bashrc"
fi
