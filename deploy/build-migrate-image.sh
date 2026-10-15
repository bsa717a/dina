#!/usr/bin/env bash
# Build and push the prisma migrate image for this commit.
# The build context is only the Prisma schema and migrations.
set -euo pipefail

if [ -z "${COMMIT_SHA:-}" ]; then
  echo "COMMIT_SHA is not set." >&2
  exit 1
fi
if ! [[ "${COMMIT_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "COMMIT_SHA is not a 40-character git sha." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRISMA_VERSION="$(
  sed -n 's/^[[:space:]]*"prisma": "\([^"]*\)".*/\1/p' "${ROOT}/package.json" | head -1
)"
if [ -z "${PRISMA_VERSION}" ]; then
  echo "Could not read the prisma version from package.json." >&2
  exit 1
fi

CONTEXT="$(mktemp -d)"
cleanup() {
  rm -rf "${CONTEXT}"
}
trap cleanup EXIT

cp -a "${ROOT}/prisma" "${CONTEXT}/prisma"
cp "${ROOT}/deploy/migrate.Dockerfile" "${CONTEXT}/Dockerfile"

IMAGE="us-central1-docker.pkg.dev/dina-pm/dina/dina-migrate:${COMMIT_SHA}"
docker build --build-arg "PRISMA_VERSION=${PRISMA_VERSION}" -t "${IMAGE}" "${CONTEXT}"
docker push "${IMAGE}"
echo "Pushed ${IMAGE}"
