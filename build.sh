#!/bin/sh

set -eu

IMAGE_NAME="${IMAGE_NAME:-withings-server}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"
BUILD_CONTEXT="${BUILD_CONTEXT:-.}"

printf 'Building image %s from %s\n' "$IMAGE" "$BUILD_CONTEXT"
docker build -t "$IMAGE" "$BUILD_CONTEXT"

printf 'Build complete: %s\n' "$IMAGE"
