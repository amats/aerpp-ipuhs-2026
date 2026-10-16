#!/usr/bin/env bash
set -euo pipefail
umask 077
BUNDLE_DIRECTORY="$(cd "$(dirname "$0")" && pwd -P)"
ACTION="${1:-}"
fail() { echo "$1" >&2; exit 1; }
from_bundle=false
if [[ -f "$BUNDLE_DIRECTORY/SHA256SUMS" && -f "$BUNDLE_DIRECTORY/release-id.txt" ]]; then
  from_bundle=true
  install_directory="${2:-$HOME/aerpp}"
  if [[ "$#" -eq 1 ]]; then set -- "$ACTION" "$install_directory"; fi
else
  install_directory="$BUNDLE_DIRECTORY"
  if [[ "$ACTION" == update ]]; then
    [[ "$#" -eq 3 && "${3:-}" == --maintenance ]] || fail "Usage: operate.sh update /path/to/extracted-bundle --maintenance"
    [[ -d "$2" ]] || fail "Extract the new bundle first."
    incoming="$(cd "$2" && pwd -P)"
    [[ -f "$incoming/release-id.txt" && -f "$incoming/operate.sh" ]] || fail "Verified distribution bundle required."
    (cd "$incoming" && shasum -a 256 -c SHA256SUMS >/dev/null)
    exec bash "$incoming/operate.sh" update "$install_directory" --maintenance
  fi
  [[ "$ACTION" != install ]] || fail "Run install.sh from an extracted bundle."
  set -- "$ACTION" "$install_directory" "${@:2}"
fi
if [[ "$install_directory" != /* || "$install_directory" == *$'\n'* || "$#" -gt 3 ]]; then
  echo "Installed usage: operate.sh start|verify; operate.sh stop|rollback|recover --maintenance; operate.sh update /path/to/extracted-bundle --maintenance" >&2
  exit 1
fi
verify_bundle() {
  (cd "$BUNDLE_DIRECTORY" && shasum -a 256 -c SHA256SUMS >/dev/null)
}
require_maintenance() {
  [[ "${3:-}" == --maintenance ]] || fail "Stop active analysis and invoke with --maintenance before changing running services."
}
case "$ACTION" in
  verify)
    [[ "$#" -eq 2 ]] || fail "Verify accepts no extra options."
    if [[ "$from_bundle" == true ]]; then verify_bundle; echo "Bundle checksums verified; no service or configuration changed."; exit 0; fi
    ;;
  install|update|rollback|recover|stop) require_maintenance "$@" ;;
  start) [[ "$#" -eq 2 || "${3:-}" == --maintenance ]] || fail "Usage: operate.sh start [--maintenance]" ;;
  *) fail "Unknown operation" ;;
esac
require_docker() {
  docker info >/dev/null 2>&1 || fail "Docker Desktopを起動してから、もう一度実行してください。"
  docker compose version >/dev/null 2>&1 || fail "Docker Composeが必要です。Docker Desktopの導入状態を確認してください。"
}
if [[ "$ACTION" == install ]]; then mkdir -p "$install_directory"; fi
[[ -d "$install_directory" ]] || fail "Existing installation required."
install_directory="$(cd "$install_directory" && pwd -P)"
if [[ "$from_bundle" == true ]]; then
  case "$install_directory/" in "$BUNDLE_DIRECTORY/"*) fail "Choose an installation directory outside the extracted bundle." ;; esac
fi
LOCK_DIRECTORY="$install_directory/.operation-lock"
mkdir "$LOCK_DIRECTORY" 2>/dev/null || fail "Another operation owns .operation-lock. If interrupted, confirm its recorded process has stopped before removing the stale lock."
probe=""
cleanup() {
  if [[ -n "$probe" ]]; then docker rm -f "$probe" >/dev/null 2>&1 || true; fi
  rm -f "$LOCK_DIRECTORY/pid" "$LOCK_DIRECTORY/pending" "$LOCK_DIRECTORY/copy" "$LOCK_DIRECTORY/check-local-llm.mjs" "$LOCK_DIRECTORY/llm-config.json"
  rmdir "$LOCK_DIRECTORY"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' "$$" > "$LOCK_DIRECTORY/pid"
PENDING_FILE="$install_directory/.pending-operation"
RELEASE_FILES=(compose.yaml images.json images.txt Caddyfile fluent-bit.conf parsers.conf release.json check-local-llm.mjs llm-config.json operate.sh README.md)
CONFIG_FILES=(profile.txt runtime.json logging-credentials.json)
read_profile() {
  profile="$(cat "$1/profile.txt")"
  case "$profile" in test|production) ;; *) fail "Invalid installation environment" ;; esac
}
compose_at() {
  AERPP_CONFIG_DIR="$install_directory/config" COMPOSE_REMOVE_ORPHANS=false docker compose --project-name "aerpp-$profile" --env-file /dev/null -f "$1/compose.yaml" -f "$install_directory/config/runtime.json" -f "$1/images.json" "${@:2}"
}
verify_images() {
  local service image platform source_id config_id actual actual_id
  while read -r service image platform source_id config_id; do
    actual="$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')" || fail "Bundled image is missing ($service). Load the images from the matching distribution again; do not delete the installation."
    [[ "$actual" == "$platform" ]] || fail "Image platform mismatch"
    if [[ -n "$source_id" && -n "$config_id" ]]; then
      actual_id="$(docker image inspect "$image" --format '{{.Id}}')"
      [[ "$actual_id" == "$source_id" || "$actual_id" == "$config_id" ]] || fail "Bundled image identity mismatch ($service); reload the matching distribution images."
    fi
  done < "$1/images.txt"
}
check_readiness() {
  require_docker
  verify_images "$1"
  local image status
  image="$(awk '$1 == "app-aerpp" {print $2}' "$1/images.txt")"
  # docker cp creates root-owned files; the Web image runs its probe as node.
  # Keep readable copies inside the private lock directory until cleanup.
  cp "$1/check-local-llm.mjs" "$LOCK_DIRECTORY/check-local-llm.mjs"
  cp "$1/llm-config.json" "$LOCK_DIRECTORY/llm-config.json"
  chmod 644 "$LOCK_DIRECTORY/check-local-llm.mjs" "$LOCK_DIRECTORY/llm-config.json"
  probe="$(docker create --pull never --entrypoint node "$image" /tmp/check-local-llm.mjs)"
  status=0
  docker cp "$LOCK_DIRECTORY/check-local-llm.mjs" "$probe:/tmp/check-local-llm.mjs" &&
    docker cp "$LOCK_DIRECTORY/llm-config.json" "$probe:/tmp/llm-config.json" &&
    docker start -a "$probe" || status=$?
  [[ "$(docker inspect "$probe" --format '{{.State.ExitCode}}')" == 0 ]] || status=1
  docker rm -f "$probe" >/dev/null
  probe=""
  if [[ "$status" -ne 0 ]]; then
    echo "Model readiness failed. Fix LM Studio, then repeat the same operation with the same bundle." >&2
    return "$status"
  fi
}
start_at() {
  check_readiness "$1"
  if ! compose_at "$1" up -d --pull never --no-build --wait --wait-timeout 120; then
    echo "Compose startup failed; containers may have changed. Repeat the same operation, or use recover with --maintenance to restore the last accepted release." >&2
    return 1
  fi
}
valid_release() { [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; }
read_pending() {
  [[ -f "$PENDING_FILE" && ! -L "$PENDING_FILE" ]] || fail "No resumable operation found."
  {
    read -r pending_action
    read -r release
    read -r bundle_hash
    read -r original
  } < "$PENDING_FILE"
  case "$pending_action" in install|update|rollback) ;; *) fail "Invalid pending operation; inspect installation." ;; esac
  valid_release "$release" || fail "Invalid pending release."
  [[ "$original" == - ]] || valid_release "$original" || fail "Invalid recovery release."
}
write_pending() {
  printf '%s\n' "$ACTION" "$release" "$bundle_hash" "$original" > "$LOCK_DIRECTORY/pending"
  mv "$LOCK_DIRECTORY/pending" "$PENDING_FILE"
}
current_release() {
  local target
  [[ -L "$install_directory/$1" ]] || fail "Accepted release reference required."
  target="$(readlink "$install_directory/$1")"
  [[ "$target" == "$install_directory/releases/"* ]] || fail "Release reference is outside the installation."
  valid_release "${target##*/}" || fail "Invalid release reference."
  [[ "$target" == "$install_directory/releases/${target##*/}" && -d "$target" ]] || fail "Invalid release reference."
  printf '%s\n' "${target##*/}"
}
compare_config() {
  local file
  for file in "${CONFIG_FILES[@]}"; do
    cmp -s "$BUNDLE_DIRECTORY/config/$file" "$install_directory/config/$file" || fail "Installed settings or logging credentials differ; use the documented configuration-change procedure."
  done
}
copy_atomic() {
  [[ ! -L "$2" && ! -d "$2" ]] || fail "Expected a regular destination file."
  cp "$1" "$LOCK_DIRECTORY/copy"
  mv "$LOCK_DIRECTORY/copy" "$2"
}
empty_installation() (
  shopt -s nullglob dotglob
  for entry in "$install_directory"/*; do
    [[ "$entry" == "$LOCK_DIRECTORY" ]] || exit 1
  done
)
activate() {
  if [[ "$original" != - ]]; then
    ln -sfn "$install_directory/releases/$original" "$install_directory/previous"
  fi
  ln -sfn "$install_directory/releases/$release" "$install_directory/current"
  rm "$PENDING_FILE"
}
case "$ACTION" in
  install|update)
    verify_bundle
    read_profile "$BUNDLE_DIRECTORY/config"
    requested_release="$(cat "$BUNDLE_DIRECTORY/release-id.txt")"
    valid_release "$requested_release" || fail "Invalid release ID."
    requested_hash="$(shasum -a 256 "$BUNDLE_DIRECTORY/SHA256SUMS" | awk '{print $1}')"
    if [[ -e "$PENDING_FILE" ]]; then
      read_pending
      if [[ "$pending_action" != "$ACTION" || "$release" != "$requested_release" || "$bundle_hash" != "$requested_hash" ]]; then
        # A failed first install has no accepted services; a corrected bundle can repair it.
        [[ "$ACTION" == install && "$pending_action" == install && "$original" == - && "$release" != "$requested_release" && ! -e "$install_directory/current" && ! -L "$install_directory/current" ]] || fail "A different operation is pending; resume it with its original bundle first."
        if [[ -e "$install_directory/config" ]]; then compare_config; fi
        [[ ! -e "$install_directory/releases/$requested_release" && ! -L "$install_directory/releases/$requested_release" ]] || fail "Replacement release already exists."
        release="$requested_release"
        bundle_hash="$requested_hash"
        write_pending
      fi
    else
      release="$requested_release"
      bundle_hash="$requested_hash"
      original=-
      if [[ "$ACTION" == install ]]; then
        empty_installation || fail "Installation is not empty; use update for an accepted installation."
      else
        original="$(current_release current)"
        compare_config
      fi
      [[ ! -e "$install_directory/releases/$release" && ! -L "$install_directory/releases/$release" ]] || fail "Release already installed; use rollback or a new bundle."
      write_pending
    fi
    if [[ "$ACTION" == install && ! -e "$install_directory/config" ]]; then
      [[ ! -L "$install_directory/.install-config" && ! -L "$install_directory/config" ]] || fail "Invalid configuration directory."
      mkdir -p "$install_directory/.install-config"
      for file in "${CONFIG_FILES[@]}"; do copy_atomic "$BUNDLE_DIRECTORY/config/$file" "$install_directory/.install-config/$file"; done
      mv "$install_directory/.install-config" "$install_directory/config"
    fi
    compare_config
    destination="$install_directory/releases/$release"
    [[ ! -L "$install_directory/releases" && ! -L "$destination" ]] || fail "Invalid release directory."
    mkdir -p "$destination"
    for file in "${RELEASE_FILES[@]}"; do copy_atomic "$BUNDLE_DIRECTORY/$file" "$destination/$file"; done
    (cd "$destination" && shasum -a 256 "${RELEASE_FILES[@]}" > SHA256SUMS)
    require_docker
    docker load -i "$BUNDLE_DIRECTORY/images.tar" >/dev/null
    if [[ "$ACTION" == install ]]; then
      check_readiness "$destination"
    else
      start_at "$destination"
    fi
    copy_atomic "$destination/operate.sh" "$install_directory/operate.sh"
    chmod 700 "$install_directory/operate.sh"
    copy_atomic "$destination/README.md" "$install_directory/README.md"
    activate
    if [[ "$ACTION" == install ]]; then
      printf 'Release installed. Start with: bash "%s/operate.sh" start\n' "$install_directory"
    else
      echo "Release activated; previous images and configuration retained."
    fi
    ;;
  verify)
    release="$(current_release current)"
    (cd "$install_directory/releases/$release" && shasum -a 256 -c SHA256SUMS >/dev/null)
    echo "Installed release checksums verified."
    ;;
  rollback)
    read_profile "$install_directory/config"
    if [[ -e "$PENDING_FILE" ]]; then
      read_pending
      [[ "$pending_action" == rollback ]] || fail "Resume the pending operation or use recover before rollback."
    else
      release="$(current_release previous)"
      original="$(current_release current)"
      bundle_hash=-
      write_pending
    fi
    start_at "$install_directory/releases/$release"
    activate
    echo "Previous images activated with current configuration; no database or volume restored."
    ;;
  recover)
    read_profile "$install_directory/config"
    read_pending
    [[ "$original" != - ]] || fail "No accepted release exists yet; repeat the initial installation with its original bundle."
    start_at "$install_directory/releases/$original"
    ln -sfn "$install_directory/releases/$original" "$install_directory/current"
    echo "Last accepted release restored. Pending operation retained; resume it with the original command and bundle."
    ;;
  start)
    [[ ! -e "$PENDING_FILE" ]] || fail "An operation is pending; resume it or use recover with --maintenance."
    read_profile "$install_directory/config"
    release="$(current_release current)"
    start_at "$install_directory/releases/$release"
    ;;
  stop)
    require_docker
    read_profile "$install_directory/config"
    if [[ -e "$PENDING_FILE" ]]; then read_pending; else release="$(current_release current)"; fi
    compose_at "$install_directory/releases/$release" stop
    ;;
esac
