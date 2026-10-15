#!/usr/bin/env bash
# Exit 0 when `gcloud run jobs execute --wait` reports a successful task.
# Usage: migrate-result.sh <gcloud-exit-status> <value-format-line>
# The line is metadata.name, status.succeededCount, status.failedCount.
# gcloud omits a zero failedCount, so a blank third field counts as 0.
# Any non-zero failedCount, a succeededCount other than 1, or a non-zero
# gcloud exit status is a failure.
set -euo pipefail

status="${1:-1}"
line="${2-}"
succeeded="$(printf '%s' "${line}" | awk '{print $2}')"
failed="$(printf '%s' "${line}" | awk '{print $3}')"

if [ "${status}" -ne 0 ]; then
  exit 1
fi
if [ "${succeeded}" != "1" ]; then
  exit 1
fi
if [ -n "${failed}" ] && [ "${failed}" != "0" ]; then
  exit 1
fi
exit 0
