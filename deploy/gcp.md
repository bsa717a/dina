# Cloud Run + Cloud SQL (GCP)

Additive deploy notes for **Cloud Run service `dina`**. This does not replace the Mac mini launchd plists (`deploy/com.dina.app.plist`, `deploy/com.dina.attention.plist`) or local `docker-compose.yml` (Postgres 16).

Public hostname stays **Cloudflare** on `dina.clifsmama.com`. Do not change DNS in this PR. After Cloud Run is healthy, point the Cloudflare origin at the Cloud Run URL (see [DNS later](#dns-later-not-this-pr)).

Do not put secret values in git, Docker build args, or GitHub Actions YAML.

## Already provisioned (do not recreate)

These already exist and are **not** required setup steps:

| Resource | Value |
| --- | --- |
| GCP project | `dina-pm` (4SL billing) |
| Cloud SQL instance | `dina-pg`, `POSTGRES_16`, `us-central1`, state RUNNABLE |
| Database / user | `dina` / `dina` |
| Instance connection name | `dina-pm:us-central1:dina-pg` |
| Artifact Registry | `us-central1-docker.pkg.dev/dina-pm/dina` |
| Secret Manager | `dina-database-url` — Cloud SQL Unix-socket `DATABASE_URL` (Prisma) |
| Cloud Run service name | `dina` |
| Min instances | `1` (Telnyx webhooks must not cold-start) |

`DATABASE_URL` in `dina-database-url` should look like (password already stored; do not commit it):

```text
postgresql://dina:PASSWORD@localhost/dina?host=/cloudsql/dina-pm:us-central1:dina-pg
```

Cloud Run mounts the socket at `/cloudsql/dina-pm:us-central1:dina-pg` when the service is connected to that instance.

## GitHub deploy service account

The workflow [`.github/workflows/deploy-gcp.yml`](../.github/workflows/deploy-gcp.yml) authenticates with `google-github-actions/auth` and GitHub Actions secret **`GCP_SA_KEY`** (JSON key). Create the SA once; do not commit the key.

```bash
PROJECT_ID=dina-pm
SA=github-deploy
SA_EMAIL="${SA}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "${SA}" \
  --project="${PROJECT_ID}" \
  --display-name="GitHub Actions Cloud Run deploy"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

# Write the JSON key to a temp file, paste into GitHub → Settings → Secrets → GCP_SA_KEY, then delete the file.
gcloud iam service-accounts keys create /tmp/dina-github-deploy.json \
  --iam-account="${SA_EMAIL}" \
  --project="${PROJECT_ID}"
```

The Cloud Run **runtime** service account (default Compute Engine SA unless you override `--service-account`) also needs:

```bash
PROJECT_ID=dina-pm
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

## Remaining secrets (create before production traffic)

`dina-database-url` already exists. Create the rest in Secret Manager from a **local** `.env` (never from the repo). Names below match the env vars in `.env.example`.

| Env var | Secret name |
| --- | --- |
| `SESSION_SECRET` | `dina-session-secret` |
| `ACCESS_CODE` | `dina-access-code` |
| `TELNYX_API_KEY` | `dina-telnyx-api-key` |
| `TELNYX_RCS_AGENT_ID` | `dina-telnyx-rcs-agent-id` |
| `TELNYX_SMS_FROM` | `dina-telnyx-sms-from` |
| `TELNYX_MESSAGING_PROFILE_ID` | `dina-telnyx-messaging-profile-id` |
| `TELNYX_WEBHOOK_SIGNING_SECRET` | `dina-telnyx-webhook-signing-secret` |
| `GROK_BOT_DINA_WEBHOOK_URL` | `dina-grok-bot-dina-webhook-url` |
| `GROK_BOT_DINA_WEBHOOK_SECRET` | `dina-grok-bot-dina-webhook-secret` |
| `GROK_BOT_DINA_API_TOKEN` | `dina-grok-bot-dina-api-token` |
| `OPENAI_API_KEY` | `dina-openai-api-key` |
| `MS_TENANT_ID` | `dina-ms-tenant-id` |
| `MS_CLIENT_ID` | `dina-ms-client-id` |
| `MS_CLIENT_SECRET` | `dina-ms-client-secret` |
| `MS_USER_EMAIL` | `dina-ms-user-email` |
| `MS_SHAREPOINT_SITE` | `dina-ms-sharepoint-site` |
| `MS_SHAREPOINT_DEFAULT_FOLDER` | `dina-ms-sharepoint-default-folder` |
| `GOOGLE_CLIENT_ID` | `dina-google-client-id` |
| `GOOGLE_CLIENT_SECRET` | `dina-google-client-secret` |
| `GOOGLE_REFRESH_TOKEN` | `dina-google-refresh-token` |
| `GOOGLE_USER_EMAIL` | `dina-google-user-email` |
| `VAPID_PUBLIC_KEY` | `dina-vapid-public-key` |
| `VAPID_PRIVATE_KEY` | `dina-vapid-private-key` |
| `VAPID_SUBJECT` | `dina-vapid-subject` |
| `ATTENTION_SCAN_SECRET` | `dina-attention-scan-secret` |

`OPENAI_MODEL_CHAT` / `OPENAI_MODEL_RESEARCH` are model names, not secrets. Set them as Cloud Run env vars if you need to override the app defaults (`gpt-4.1-nano` / `gpt-4.1`).

Create one secret from a local value (example — run on a machine that already has `.env`, not in CI logs):

```bash
PROJECT_ID=dina-pm

# Create empty secret, then add a version from stdin (value never written to the repo).
gcloud secrets create dina-session-secret --project="${PROJECT_ID}"
printf '%s' "${SESSION_SECRET}" | gcloud secrets versions add dina-session-secret \
  --project="${PROJECT_ID}" \
  --data-file=-
```

Repeat for each row in the table. Skip create if the secret already exists; only add a new version.

Optional extras in `.env.example` (GitHub PATs / GitHub App keys, `GITHUB_ACCOUNTS`, …) are not required to boot Cloud Run. Add them the same way if you want those tools in production.

Bind remaining secrets onto the service (additive; does not remove `DATABASE_URL`):

```bash
gcloud run services update dina \
  --project=dina-pm \
  --region=us-central1 \
  --update-secrets="\
SESSION_SECRET=dina-session-secret:latest,\
ACCESS_CODE=dina-access-code:latest,\
TELNYX_API_KEY=dina-telnyx-api-key:latest,\
TELNYX_RCS_AGENT_ID=dina-telnyx-rcs-agent-id:latest,\
TELNYX_SMS_FROM=dina-telnyx-sms-from:latest,\
TELNYX_MESSAGING_PROFILE_ID=dina-telnyx-messaging-profile-id:latest,\
TELNYX_WEBHOOK_SIGNING_SECRET=dina-telnyx-webhook-signing-secret:latest,\
GROK_BOT_DINA_WEBHOOK_URL=dina-grok-bot-dina-webhook-url:latest,\
GROK_BOT_DINA_WEBHOOK_SECRET=dina-grok-bot-dina-webhook-secret:latest,\
GROK_BOT_DINA_API_TOKEN=dina-grok-bot-dina-api-token:latest,\
OPENAI_API_KEY=dina-openai-api-key:latest,\
MS_TENANT_ID=dina-ms-tenant-id:latest,\
MS_CLIENT_ID=dina-ms-client-id:latest,\
MS_CLIENT_SECRET=dina-ms-client-secret:latest,\
MS_USER_EMAIL=dina-ms-user-email:latest,\
MS_SHAREPOINT_SITE=dina-ms-sharepoint-site:latest,\
MS_SHAREPOINT_DEFAULT_FOLDER=dina-ms-sharepoint-default-folder:latest,\
GOOGLE_CLIENT_ID=dina-google-client-id:latest,\
GOOGLE_CLIENT_SECRET=dina-google-client-secret:latest,\
GOOGLE_REFRESH_TOKEN=dina-google-refresh-token:latest,\
GOOGLE_USER_EMAIL=dina-google-user-email:latest,\
VAPID_PUBLIC_KEY=dina-vapid-public-key:latest,\
VAPID_PRIVATE_KEY=dina-vapid-private-key:latest,\
VAPID_SUBJECT=dina-vapid-subject:latest,\
ATTENTION_SCAN_SECRET=dina-attention-scan-secret:latest"
```

Omit any pair whose secret is not created yet. Cloud Run fails the update if a named secret is missing.

## Build and push

From the repo root (Dockerfile uses Node 22, `prisma generate` at build, start runs `prisma migrate deploy` then `next start -H 0.0.0.0 -p $PORT`):

```bash
PROJECT_ID=dina-pm
REGION=us-central1
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/dina/dina"

gcloud auth configure-docker "${REGION}-docker.pkg.dev"

docker build -t "${IMAGE}:$(git rev-parse --short HEAD)" -t "${IMAGE}:latest" .
docker push "${IMAGE}:$(git rev-parse --short HEAD)"
docker push "${IMAGE}:latest"
```

Or Cloud Build (same Artifact Registry; `.gcloudignore` excludes `.env`):

```bash
gcloud builds submit \
  --project=dina-pm \
  --tag="us-central1-docker.pkg.dev/dina-pm/dina/dina:$(git rev-parse --short HEAD)"
```

## Deploy Cloud Run

```bash
PROJECT_ID=dina-pm
REGION=us-central1
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/dina/dina:latest"

gcloud run deploy dina \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --image="${IMAGE}" \
  --allow-unauthenticated \
  --set-cloudsql-instances=dina-pm:us-central1:dina-pg \
  --min-instances=1 \
  --max-instances=4 \
  --cpu=1 \
  --memory=1Gi \
  --no-cpu-throttling \
  --timeout=300 \
  --update-env-vars="NODE_ENV=production,APP_URL=https://dina.clifsmama.com" \
  --update-secrets="DATABASE_URL=dina-database-url:latest"
```

Notes:

- Container listens on `process.env.PORT` (Cloud Run injects it). `package.json` `start` still hardcodes `8080` for Mac launchd; the image entrypoint does not use that script.
- `--allow-unauthenticated` lets Cloudflare fetch the origin. App login remains `ACCESS_CODE` / session cookies.
- `--min-instances=1` keeps one warm instance for Telnyx webhooks (`/api/telnyx/webhook` is already a public path in the app).
- Uploads stay on local disk (`data/uploads`). Cloud Run disk is ephemeral; a bucket is out of scope for this PR.
- Prisma migrations run at **container start** (`prisma migrate deploy`) against Cloud SQL via the Unix socket.

Health check: `GET /api/health` on the Cloud Run URL.

## DNS later (not this PR)

1. Deploy and confirm `/api/health` on the Cloud Run URL (`https://dina-….run.app`).
2. In Cloudflare, set the origin for `dina.clifsmama.com` to that Cloud Run hostname (HTTPS). Do not change DNS until that origin is ready.
3. Keep `APP_URL=https://dina.clifsmama.com` so cookies and absolute links match the public hostname.
4. Point Telnyx webhooks at `https://dina.clifsmama.com/api/telnyx/webhook` after the origin switch.

## GitHub Actions

Workflow [`.github/workflows/deploy-gcp.yml`](../.github/workflows/deploy-gcp.yml):

- Triggers: `workflow_dispatch` and `push` to `main`
- Secret: `GCP_SA_KEY` (JSON). No secret **values** in YAML
- Builds/pushes `us-central1-docker.pkg.dev/dina-pm/dina/dina:$GITHUB_SHA`
- Deploys Cloud Run `dina` with Cloud SQL `dina-pm:us-central1:dina-pg`, `--min-instances=1`, `DATABASE_URL` from `dina-database-url`
- Uses `--update-secrets` so attaching the remaining secrets above is not wiped on the next push
