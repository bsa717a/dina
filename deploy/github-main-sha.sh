#!/usr/bin/env bash
# Print the current head sha of bsa717a/dina main.
# Uses the Cloud Build read token for connection Piper-Dina.
# The token is not printed. Do not run this script with xtrace.
set -euo pipefail

if [ -z "${_LINKED_REPO:-}" ] || [ "${_LINKED_REPO}" = "SET_LINKED_REPO_ID" ]; then
  echo "Substitution _LINKED_REPO is not set to the Piper-Dina linked repository id." >&2
  exit 1
fi

REPO="projects/dina-pm/locations/us-central1/connections/Piper-Dina/repositories/${_LINKED_REPO}"
TOKEN="$(
  curl -fsS -X POST \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    "https://cloudbuild.googleapis.com/v2/${REPO}:accessReadToken" \
    | python3 -c 'import json,sys; data=json.load(sys.stdin); token=data.get("token") or ""; sys.exit("read token request failed") if not token else print(token)'
)"
HEAD="$(
  curl -fsS \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/bsa717a/dina/commits/main \
    | python3 -c 'import json,sys; data=json.load(sys.stdin); sha=data.get("sha") or ""; sys.exit("main sha missing") if not sha else print(sha)'
)"
unset TOKEN
printf '%s\n' "${HEAD}"
