#!/usr/bin/env bash
#
# classroom-cli installer / updater
#
# One-liner (latest stable, default OS/arch):
#   curl -fsSL https://raw.githubusercontent.com/paoloose/google-classroom-cli/main/scripts/install.sh | bash
#
# Pin a specific version:
#   curl -fsSL .../install.sh | bash -s -- --version v0.0.1
#
# Install a pre-release (e.g. beta):
#   curl -fsSL .../install.sh | bash -s -- --prerelease
#
# Force reinstall even if the resolved version is the same:
#   curl -fsSL .../install.sh | bash -s -- --force
#
# Install into a custom directory (otherwise defaults to ~/.config/classroom-cli):
#   curl -fsSL .../install.sh | bash -s -- --install-dir /opt/classroom-cli
#
# Layout after install:
#   $CLASSROOM_CLI_HOME/
#     bin/classroom              ← symlink → ../repo/dist/classroom
#     repo/                      ← unpacked CLI source
#       .classroom-cli-version
#       src/cli.ts (or dist/...)
#     sessions/, audit/, ...     ← existing credential dirs stay intact
#
# All flags are also exposed via env vars (see env_or_arg).

set -euo pipefail

# ---------- config ----------
REPO_OWNER="${CLASSROOM_CLI_REPO_OWNER:-paoloose}"
REPO_NAME="${CLASSROOM_CLI_REPO_NAME:-google-classroom-cli}"
REPO="${REPO_OWNER}/${REPO_NAME}"
GITHUB_API="https://api.github.com"
GITHUB_DL="https://github.com/${REPO}/releases/download"

APP_NAME="classroom-cli"
APP_BIN="classroom"

# Allowed release artifact platforms. Anything outside this list is rejected
# before we hand it to tar/zip. This is the user-side mirror of the allow-list
# enforced in the release workflow.
ALLOWED_TARGETS=(
  "linux-x64"
  "linux-arm64"
  "darwin-x64"
  "darwin-arm64"
  "windows-x64"
)

# ---------- arg parsing ----------
VERSION=""
PRERELEASE=0
FORCE=0
INSTALL_DIR=""
CHANNEL="stable"
DRY_RUN=0

usage() {
  cat <<EOF
classroom-cli installer

Usage: install.sh [options]

Options:
  --version <vX.Y.Z>    Install a specific release tag (default: latest non-prerelease)
  --prerelease          Include pre-releases when resolving "latest" (-beta, -rc, etc.)
  --channel <name>      Channel to follow. "stable" (default) or "beta".
                        Equivalent to --prerelease for "beta".
  --install-dir <path>  Override install root (default: \$CLASSROOM_CLI_HOME or ~/.config/${APP_NAME})
  --force               Re-download even if the installed version matches
  --dry-run             Print actions without executing them
  -h, --help            Show this help

Environment variables:
  CLASSROOM_CLI_HOME        Install root (overridden by --install-dir)
  CLASSROOM_CLI_REPO_OWNER  GitHub owner (default: paoloose)
  CLASSROOM_CLI_REPO_NAME   GitHub repo (default: google-classroom-cli)
  GITHUB_TOKEN              Optional auth token for GitHub API (raises rate limit)
EOF
}

env_or_arg() {
  # echo first non-empty: arg, env, default
  local arg="$1" envvar="$2" default="$3"
  if [[ -n "$arg" ]]; then echo "$arg"
  elif [[ -n "${!envvar:-}" ]]; then echo "${!envvar}"
  else echo "$default"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)        VERSION="$2"; shift 2 ;;
    --prerelease)     PRERELEASE=1; CHANNEL="beta"; shift ;;
    --channel)        CHANNEL="$2"; shift 2 ;;
    --install-dir)     INSTALL_DIR="$2"; shift 2 ;;
    --force)          FORCE=1; shift ;;
    --dry-run)        DRY_RUN=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 64 ;;
  esac
done

if [[ "$CHANNEL" == "beta" ]]; then PRERELEASE=1; fi
if [[ "$CHANNEL" != "stable" && "$CHANNEL" != "beta" ]]; then
  echo "Invalid --channel: $CHANNEL (expected 'stable' or 'beta')" >&2
  exit 64
fi

# ---------- platform detection ----------
detect_target() {
  local os arch
  case "$(uname -s)" in
    Linux)   os="linux" ;;
    Darwin)  os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64)   arch="x64" ;;
    aarch64|arm64)  arch="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  echo "${os}-${arch}"
}

TARGET="$(detect_target)"
IS_WINDOWS=0
if [[ "$TARGET" == windows-* ]]; then IS_WINDOWS=1; fi
BIN_EXT=""
if [[ $IS_WINDOWS -eq 1 ]]; then BIN_EXT=".exe"; fi

# ---------- install paths ----------
INSTALL_DIR="$(env_or_arg "$INSTALL_DIR" CLASSROOM_CLI_HOME "$HOME/.config/${APP_NAME}")"
REPO_DIR="${INSTALL_DIR}/repo"
BIN_DIR="${INSTALL_DIR}/bin"
BIN_PATH="${BIN_DIR}/${APP_BIN}${BIN_EXT}"
VERSION_FILE="${REPO_DIR}/.classroom-cli-version"

# Allow-list sanity check
allowed_target=0
for t in "${ALLOWED_TARGETS[@]}"; do
  if [[ "$t" == "$TARGET" ]]; then allowed_target=1; break; fi
done
if [[ $allowed_target -eq 0 ]]; then
  echo "Target '$TARGET' is not in the published artifact allow-list." >&2
  echo "Supported targets: ${ALLOWED_TARGETS[*]}" >&2
  exit 1
fi

# ---------- version resolution ----------
# Uses GitHub Releases API. Returns the tag_name of the chosen release.
resolve_version() {
  local include_prerelease="$1"
  local api_query="?per_page=50"
  if [[ "$include_prerelease" == "1" ]]; then api_query="${api_query}"  # include pre-releases
  else api_query="${api_query}&pre_release=false"
  fi

  local headers=()
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    headers+=(-H "Authorization: token ${GITHUB_TOKEN}")
  else
    headers+=(-H "User-Agent: ${APP_NAME}-installer")
  fi

  local body
  body="$(curl -fsSL "${headers[@]}" "${GITHUB_API}/repos/${REPO}/releases${api_query}")" || {
    echo "Failed to query GitHub Releases API for ${REPO}." >&2
    exit 1
  }

  # Pick the first (most recent) release. With pre_release=false, GitHub already
  # filters out prereleases. With pre_release=true (default), we keep them and
  # rely on the API order (newest first).
  local tag
  tag="$(printf '%s' "$body" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  if [[ -z "$tag" ]]; then
    echo "No matching release found for channel '$CHANNEL'." >&2
    exit 1
  fi
  echo "$tag"
}

# Strip a leading 'v' for storage but keep it in the tag string.
strip_v() { printf '%s' "${1#v}"; }

# Compare dotted versions: returns 0 if $1 > $2, 1 if equal, 2 if less.
# Not a full semver comparator — but enough for our needs.
version_gt() {
  local IFS=.
  local a=($1) b=($2)
  local i
  for ((i=0; i<${#a[@]} || i<${#b[@]}; i++)); do
    local av="${a[i]:-0}" bv="${b[i]:-0}"
    # strip pre-release suffix from last non-empty segment on each side
    av="${av%%-*}"
    bv="${bv%%-*}"
    if (( av > bv )) 2>/dev/null; then return 0; fi
    if (( av < bv )) 2>/dev/null; then return 2; fi
  done
  return 1
}

INSTALLED_VERSION=""
if [[ -f "$VERSION_FILE" ]]; then
  INSTALLED_VERSION="$(cat "$VERSION_FILE" 2>/dev/null || true)"
fi

if [[ -z "$VERSION" ]]; then
  VERSION="$(resolve_version "$PRERELEASE")"
fi

NEED_INSTALL=1
if [[ -n "$INSTALLED_VERSION" ]]; then
  # Skip only when the installed version exactly matches the resolved one.
  # Roll-forward (latest) handles upgrades automatically; pinned --version
  # flags are an explicit user action and we honor them in either direction.
  if [[ "$VERSION" == "$INSTALLED_VERSION" && "$FORCE" -eq 0 ]]; then
    NEED_INSTALL=0
  fi
fi

# ---------- announce ----------
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] target       = $TARGET"
  echo "[dry-run] install-dir  = $INSTALL_DIR"
  echo "[dry-run] repo-dir     = $REPO_DIR"
  echo "[dry-run] bin-path     = $BIN_PATH"
  echo "[dry-run] version      = $VERSION (channel=$CHANNEL)"
  echo "[dry-run] installed    = ${INSTALLED_VERSION:-none}"
  echo "[dry-run] need-install = $NEED_INSTALL"
fi

if [[ "$NEED_INSTALL" -eq 0 ]]; then
  cat <<EOF
✔ classroom ${INSTALLED_VERSION} already installed at ${BIN_PATH}
  Run \`${APP_BIN} --help\` to verify, or re-run with --force to reinstall.
EOF
  exit 0
fi

# ---------- download ----------
ARTIFACT_NAME="${APP_NAME}_${TARGET}.tar.gz"
CHECKSUM_NAME="${APP_NAME}_${TARGET}.tar.gz.sha256"
DOWNLOAD_URL="${GITHUB_DL}/${VERSION}/${ARTIFACT_NAME}"
CHECKSUM_URL="${GITHUB_DL}/${VERSION}/${CHECKSUM_NAME}"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

curl_get() {
  local url="$1" out="$2"
  local headers=(-fsSL)
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    headers+=(-H "Authorization: token ${GITHUB_TOKEN}")
  fi
  curl "${headers[@]}" -o "$out" "$url"
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would download: $DOWNLOAD_URL"
  echo "[dry-run] would verify : $CHECKSUM_URL"
  echo "[dry-run] would extract into $REPO_DIR"
  echo "[dry-run] would link   : $BIN_PATH → $REPO_DIR/dist/${APP_BIN}${BIN_EXT}"
  exit 0
fi

echo "→ Downloading ${APP_NAME} ${VERSION} for ${TARGET}…"
curl_get "$DOWNLOAD_URL" "$TMPDIR/$ARTIFACT_NAME"
curl_get "$CHECKSUM_URL" "$TMPDIR/$CHECKSUM_NAME"

# Verify SHA-256 (single line "hex  filename" format)
EXPECTED="$(awk '{print $1}' "$TMPDIR/$CHECKSUM_NAME")"
ACTUAL="$(shasum -a 256 "$TMPDIR/$ARTIFACT_NAME" | awk '{print $1}')"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "Checksum mismatch for $ARTIFACT_NAME" >&2
  echo "  expected: $EXPECTED" >&2
  echo "  actual  : $ACTUAL" >&2
  exit 1
fi
echo "✔ Checksum verified"

# ---------- install ----------
mkdir -p "$BIN_DIR"

# Preserve credentials across installs by stashing the home dir's sessions dir.
PRESERVE_DIR=""
if [[ -d "$INSTALL_DIR/sessions" ]]; then
  PRESERVE_DIR="$TMPDIR/sessions-preserve"
  cp -R "$INSTALL_DIR/sessions" "$PRESERVE_DIR"
fi

# Wipe and re-extract the repo dir.
rm -rf "$REPO_DIR"
mkdir -p "$REPO_DIR"
tar -xzf "$TMPDIR/$ARTIFACT_NAME" -C "$REPO_DIR"

# Restore credentials.
if [[ -n "$PRESERVE_DIR" ]]; then
  rm -rf "$INSTALL_DIR/sessions"
  mkdir -p "$INSTALL_DIR/sessions"
  cp -R "$PRESERVE_DIR/." "$INSTALL_DIR/sessions/"
  chmod 700 "$INSTALL_DIR/sessions"
fi

# Write version marker.
printf '%s\n' "$VERSION" > "$VERSION_FILE"

# Create bin symlink. On Windows (MSYS/Git Bash) symlinks aren't reliable, so
# we drop a tiny .cmd shim instead.
if [[ $IS_WINDOWS -eq 1 ]]; then
  cat > "${BIN_PATH}.cmd" <<EOF
@echo off
"$(cygpath -w "$REPO_DIR/dist/${APP_BIN}.exe")" %*
EOF
else
  ln -sf "../repo/dist/${APP_BIN}${BIN_EXT}" "$BIN_PATH"
fi

echo "✔ Installed ${APP_NAME} ${VERSION} → ${BIN_PATH}"

# ---------- PATH nudge ----------
warn_path=0
if [[ $IS_WINDOWS -eq 1 ]]; then
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) warn_path=1 ;;
  esac
else
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) warn_path=1 ;;
  esac
fi

if [[ $warn_path -eq 1 ]]; then
  cat <<EOF

⚠ ${BIN_DIR} is not on your PATH.

Add it to your shell rc:
  export PATH="${BIN_DIR}:\$PATH"

Or call the binary by absolute path:
  ${BIN_PATH} --help
EOF
fi