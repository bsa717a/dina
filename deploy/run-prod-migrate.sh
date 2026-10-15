#!/usr/bin/env bash
# Apply pending Prisma migrations to production Cloud SQL, then return.
# Cloud Run service dina is updated only by a later build step, after this
# script exits 0. This script does not print DATABASE_URL.
# Do not run this script with xtrace.
set -euo pipefail

PROJECT="dina-pm"
REGION="us-central1"
JOB="dina-migrate"
INSTANCE="dina-pm:us-central1:dina-pg"
SECRET="dina-database-url"
RUNTIME_SA="585818436276-compute@developer.gserviceaccount.com"

if [ -z "${BUILD_ID:-}" ]; then
  echo "Refusing to migrate outside Cloud Build." >&2
  exit 1
fi
if [ -z "${COMMIT_SHA:-}" ] || ! [[ "${COMMIT_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "COMMIT_SHA is not a 40-character git sha." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "Checking that this commit is still the head of main."
HEAD="$(bash "${ROOT}/deploy/github-main-sha.sh")" || exit 1
if [ "${HEAD}" != "${COMMIT_SHA}" ]; then
  echo "Refusing to migrate. main is ${HEAD}; this build is ${COMMIT_SHA}."
  exit 1
fi

IMAGE="us-central1-docker.pkg.dev/${PROJECT}/dina/dina-migrate:${COMMIT_SHA}"
echo "Updating Cloud Run job ${JOB} to image ${IMAGE}."
gcloud run jobs deploy "${JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --service-account="${RUNTIME_SA}" \
  --set-cloudsql-instances="${INSTANCE}" \
  --set-secrets="DATABASE_URL=${SECRET}:latest" \
  --tasks=1 \
  --parallelism=1 \
  --max-retries=0 \
  --task-timeout=600s \
  --memory=1Gi \
  --cpu=1 \
  --quiet

echo "Running prisma migrate deploy on job ${JOB}."
set +e
RESULT="$(
  gcloud run jobs execute "${JOB}" \
    --project="${PROJECT}" \
    --region="${REGION}" \
    --wait \
    --quiet \
    --format='value(metadata.name,status.succeededCount,status.failedCount)'
)"
status=$?
set -e
echo "Migration execution result: ${RESULT:-<none>} (exit ${status})"
FAILED="$(printf '%s' "${RESULT}" | awk '{print $3}')"
SUCCEEDED="$(printf '%s' "${RESULT}" | awk '{print $2}')"
if [ "${status}" -ne 0 ] || [ "${SUCCEEDED}" != "1" ] || [ "${FAILED}" != "0" ]; then
  echo "prisma migrate deploy failed. Cloud Run service dina was not updated. Traffic was not moved."
  exit 1
fi
echo "Migrations applied. The new Cloud Run revision is not deployed yet."
