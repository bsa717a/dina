#!/bin/bash
# Wait for Homebrew Postgres, then start Dina.
# launchd LaunchAgents can start before postgresql@16 is accepting connections.
set -euo pipefail

export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

cd /Users/derekfowler/repo/dina

echo "dina: waiting for postgres"
for i in $(seq 1 60); do
  if pg_isready -q; then
    echo "dina: postgres ready (${i}s)"
    exec /opt/homebrew/opt/node@22/bin/npm run start
  fi
  sleep 1
done

echo "dina: postgres did not become ready within 60s" >&2
exit 1
