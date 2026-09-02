#!/bin/sh
set -eu

# Cloud Run sets PORT. Local `docker run` defaults to 8080 (same as package.json).
PORT="${PORT:-8080}"

echo "Applying Prisma migrations (migrate deploy)..."
./node_modules/.bin/prisma migrate deploy

echo "Starting Next.js on 0.0.0.0:${PORT}"
exec ./node_modules/.bin/next start -H 0.0.0.0 -p "${PORT}"
