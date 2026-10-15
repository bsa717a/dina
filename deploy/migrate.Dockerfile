# Image for Cloud Run job dina-migrate only.
# The service image is still built with Cloud Buildpacks. This file is not
# a root Dockerfile, and pack does not use it.
#
# The image contains the Prisma CLI, schema, and migrations. It has no
# application server and no secret values. Cloud Run injects DATABASE_URL
# from Secret Manager secret dina-database-url at job start.

FROM mirror.gcr.io/library/node:22.23.3-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY prisma ./prisma

ARG PRISMA_VERSION=6.19.2
RUN npm install --no-fund --no-audit "prisma@${PRISMA_VERSION}" \
  && test -f /app/node_modules/prisma/build/index.js \
  && npm cache clean --force

ENV CI=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1

ENTRYPOINT ["/usr/local/bin/node", "/app/node_modules/prisma/build/index.js", "migrate", "deploy"]
