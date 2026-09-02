# Production image for Cloud Run service `dina` (Next.js 16 + Prisma).
# Local Mac launchd plists and docker-compose.yml are unchanged.

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
# Include devDependencies: `prisma` CLI, TypeScript, Tailwind are needed to build.
# Do not set NODE_ENV=production before npm ci or those are omitted.
RUN npm ci

COPY . .

# Placeholder for `prisma generate` / `next build` only. Not a credential.
# Runtime DATABASE_URL comes from Secret Manager (`dina-database-url`).
ENV DATABASE_URL="postgresql://dina@127.0.0.1:5432/dina?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npx prisma generate \
  && npx next build \
  && mkdir -p /app/data/uploads \
  && chmod +x /app/docker-entrypoint.sh \
  && chown -R node:node /app

# Force runtime to supply DATABASE_URL (Secret Manager), not the build placeholder.
ENV DATABASE_URL=""
ENV HOST=0.0.0.0
# Cloud Run overrides PORT. 8080 is only the local-docker default.
ENV PORT=8080

USER node
EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
