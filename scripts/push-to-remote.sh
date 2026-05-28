#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-withings-server:latest}"
REMOTE_HOST="${REMOTE_HOST:-myuser@mydockerhost}"
REMOTE_TAR_PATH="${REMOTE_TAR_PATH:-/tmp/withings-server-image.tar}"
KEEP_TAR="${KEEP_TAR:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"

usage() {
  cat <<'EOF'
Build, transfer, and load a Docker image on a remote host via SCP/SSH.

Usage:
  scripts/push-to-remote.sh [--image IMAGE] [--host USER@HOST] [--remote-tar /path/file.tar] [--skip-build] [--keep-tar]

Options:
  --image IMAGE          Docker image tag to build/save/load (default: withings-server:latest)
  --host USER@HOST       SSH/SCP target host (default: myuser@mydockerhost)
  --remote-tar PATH      Destination tar path on remote host (default: /tmp/withings-server-image.tar)
  --skip-build           Skip docker build step and push existing local image
  --keep-tar             Keep local and remote tar files after load
  -h, --help             Show this help

Environment variables (optional):
  IMAGE_NAME, REMOTE_HOST, REMOTE_TAR_PATH, SKIP_BUILD=1, KEEP_TAR=1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      IMAGE_NAME="$2"
      shift 2
      ;;
    --host)
      REMOTE_HOST="$2"
      shift 2
      ;;
    --remote-tar)
      REMOTE_TAR_PATH="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --keep-tar)
      KEEP_TAR=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed." >&2
  exit 1
fi
if ! command -v scp >/dev/null 2>&1; then
  echo "scp is required but not installed." >&2
  exit 1
fi
if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh is required but not installed." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_TAR="$(mktemp /tmp/withings-server-image.XXXXXX.tar)"

cleanup() {
  if [[ "$KEEP_TAR" != "1" ]]; then
    rm -f "$TMP_TAR"
    ssh "$REMOTE_HOST" "rm -f '$REMOTE_TAR_PATH'" >/dev/null 2>&1 || true
  else
    echo "Keeping local tar: $TMP_TAR"
    echo "Keeping remote tar: $REMOTE_HOST:$REMOTE_TAR_PATH"
  fi
}
trap cleanup EXIT

if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "==> Building image $IMAGE_NAME"
  docker build -t "$IMAGE_NAME" "$PROJECT_ROOT"
else
  echo "==> Skipping build for image $IMAGE_NAME"
fi

echo "==> Saving image to $TMP_TAR"
docker save "$IMAGE_NAME" -o "$TMP_TAR"

echo "==> Copying tar to $REMOTE_HOST:$REMOTE_TAR_PATH"
scp "$TMP_TAR" "$REMOTE_HOST:$REMOTE_TAR_PATH"

echo "==> Loading image on $REMOTE_HOST"
ssh "$REMOTE_HOST" "docker load -i '$REMOTE_TAR_PATH'"

echo "==> Verifying image on remote"
ssh "$REMOTE_HOST" "docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}' | grep '^${IMAGE_NAME//\//\/} ' || true"

echo "Done. Image '$IMAGE_NAME' is loaded on $REMOTE_HOST"
