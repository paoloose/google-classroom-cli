#!/usr/bin/env bash
#
# classroom-cli uninstaller
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/paoloose/google-classroom-cli/main/scripts/uninstall.sh | bash
#   ./scripts/uninstall.sh [--purge] [--install-dir <path>]
#
# Flags:
#   --purge        Also remove configuration, active profiles, and session credentials
#   --install-dir  Override install directory (default: ~/.config/classroom-cli)
#   --dry-run      Print actions without modifying files

set -euo pipefail

APP_NAME="classroom-cli"
APP_BIN="classroom"
PURGE=0
DRY_RUN=0
INSTALL_DIR="${CLASSROOM_CLI_HOME:-$HOME/.config/${APP_NAME}}"

usage() {
  cat <<EOF
classroom-cli uninstaller

Usage: uninstall.sh [options]

Options:
  --purge               Remove all configurations, saved profiles, and auth sessions
  --install-dir <path>  Install directory to remove (default: \$CLASSROOM_CLI_HOME or ~/.config/${APP_NAME})
  --dry-run             Print actions without executing them
  -h, --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)        PURGE=1; shift ;;
    --install-dir)  INSTALL_DIR="$2"; shift 2 ;;
    --dry-run)      DRY_RUN=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 64 ;;
  esac
done

REPO_DIR="${INSTALL_DIR}/repo"
BIN_DIR="${INSTALL_DIR}/bin"
BIN_PATH="${BIN_DIR}/${APP_BIN}"
VERSION_FILE="${REPO_DIR}/.classroom-cli-version"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] install-dir = $INSTALL_DIR"
  echo "[dry-run] repo-dir    = $REPO_DIR"
  echo "[dry-run] bin-path    = $BIN_PATH"
  echo "[dry-run] purge       = $PURGE"
  echo "[dry-run] would remove repo and binary symlinks"
  if [[ "$PURGE" -eq 1 ]]; then
    echo "[dry-run] would purge all configs and sessions"
  fi
  exit 0
fi

echo "→ Uninstalling ${APP_NAME}…"

# Remove binary symlink / launcher
if [[ -f "$BIN_PATH" || -L "$BIN_PATH" ]]; then
  rm -f "$BIN_PATH"
  echo "✔ Removed binary: $BIN_PATH"
fi
if [[ -f "${BIN_PATH}.cmd" ]]; then
  rm -f "${BIN_PATH}.cmd"
  echo "✔ Removed binary shim: ${BIN_PATH}.cmd"
fi

# Remove unpacked repository files
if [[ -d "$REPO_DIR" ]]; then
  rm -rf "$REPO_DIR"
  echo "✔ Removed repo files: $REPO_DIR"
fi

if [[ -f "$VERSION_FILE" ]]; then
  rm -f "$VERSION_FILE"
fi

if [[ "$PURGE" -eq 1 ]]; then
  echo "→ Purging configuration and credentials from ${INSTALL_DIR}…"
  rm -rf "$INSTALL_DIR"
  echo "✔ Successfully purged ${INSTALL_DIR}"
else
  # Clean up empty bin directory if empty
  if [[ -d "$BIN_DIR" ]] && [[ -z "$(ls -A "$BIN_DIR" 2>/dev/null)" ]]; then
    rmdir "$BIN_DIR" 2>/dev/null || true
  fi
  echo "✔ Uninstalled ${APP_NAME} binary."
  echo "ℹ Configuration and credentials preserved at: ${INSTALL_DIR}"
  echo "  (Pass --purge to remove credentials and configuration as well)"
fi
