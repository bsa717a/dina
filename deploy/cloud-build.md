# Production deploy (Cloud Build → Cloud Run)

A push to `main` builds and deploys Cloud Run service `dina` in project `dina-pm`, region `us-central1`. The trigger runs as `dina-cloudbuild@dina-pm.iam.gserviceaccount.com`. There is no downloadable key and no personal `gcloud auth login`.

Config: [`cloudbuild.yaml`](../cloudbuild.yaml).

What a push does:

1. Google Cloud Buildpacks build the image (this repo has no Dockerfile, which is the same choice `gcloud run deploy --source` makes).
2. The image is pushed to the existing Artifact Registry repository `us-central1-docker.pkg.dev/dina-pm/dina/dina`.
3. `gcloud run deploy` ships that image as a new revision of service `dina`.
4. `gcloud run services update-traffic dina --to-latest` sends 100% of traffic to that revision.

The deploy command does not pass `--set-env-vars`, `--clear-env-vars`, `--set-secrets`, `--update-secrets`, `--remove-secrets`, or `--clear-secrets`. Existing Cloud Run environment variables, Secret Manager mounts, and Cloud SQL settings stay as they are. Do not delete secrets.

The build does not run `prisma migrate`. `npm start` is unchanged (`next start` on port 8080). The Cloud Run container port for `dina` needs to stay 8080.

`deploy/com.dina.app.plist` is not the production deploy. Do not load it to ship Dina.

## One-time setup (not in git)

A person does these once, in this order. This repository cannot do them. Do not create a service account key.

### 1. Enable APIs

No browser click. Run this with an admin account that can enable APIs on `dina-pm`:

```bash
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  --project=dina-pm
```

Artifact Registry repository `dina` in `us-central1` is already provisioned. Do not create a second registry. Confirm it:

```bash
gcloud artifacts repositories describe dina \
  --project=dina-pm \
  --location=us-central1
```

Run this only when that describe command fails:

```bash
gcloud artifacts repositories create dina \
  --project=dina-pm \
  --location=us-central1 \
  --repository-format=docker \
  --description="Dina Cloud Run images"
```

### 2. Create the build service account and its roles

No browser click. The account is `dina-cloudbuild@dina-pm.iam.gserviceaccount.com`.

```bash
PROJECT_ID=dina-pm
SA_EMAIL="dina-cloudbuild@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create dina-cloudbuild \
  --project="${PROJECT_ID}" \
  --display-name="Dina Cloud Build deploy"

# Build logs (the config uses CLOUD_LOGGING_ONLY, so no logs bucket is required).
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/logging.logWriter"

# Push the image to repository `dina` only.
gcloud artifacts repositories add-iam-policy-binding dina \
  --project="${PROJECT_ID}" \
  --location=us-central1 \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

# Deploy a revision and move traffic. This role does not change Cloud Run IAM.
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.developer"

# Let gcloud check that the Run API is enabled.
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/serviceusage.serviceUsageConsumer"
```

Grant `roles/iam.serviceAccountUser` only on the identity Cloud Run service `dina` already runs as, so the build can deploy a revision as that identity. Do not grant this role on the whole project.

```bash
PROJECT_ID=dina-pm
SA_EMAIL="dina-cloudbuild@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

RUNTIME_SA="$(gcloud run services describe dina \
  --project="${PROJECT_ID}" \
  --region=us-central1 \
  --format='value(spec.template.spec.serviceAccountName)')"

if [ -z "${RUNTIME_SA}" ]; then
  RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"
```

Let Cloud Build start builds as `dina-cloudbuild` (still no key):

```bash
PROJECT_ID=dina-pm
SA_EMAIL="dina-cloudbuild@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-cloudbuild.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### 3. Connect the GitHub repo — a person must click

This step is a browser flow. `gcloud` cannot install the Cloud Build GitHub App.

1. Open [Cloud Build triggers for `dina-pm`](https://console.cloud.google.com/cloud-build/triggers?project=dina-pm).
2. Click **Connect repository**.
3. Click **GitHub (Cloud Build GitHub App)**.
4. On GitHub, click through install or authorize **Google Cloud Build** for account `bsa717a`, and grant that app access to `bsa717a/dina`.
5. Back in Google Cloud, select `bsa717a/dina` and click **Connect**.

Skip this only when Cloud Build in `dina-pm` already lists `bsa717a/dina` as a connected repository.

### 4. Create the trigger on pushes to `main`

No browser click if you use this command. Run it after step 3. The service account must match `cloudbuild.yaml`. Leave the trigger in the global region. `us-central1` is the Cloud Run region inside the config, not the trigger region. A regional trigger cannot see this GitHub App connection.

```bash
gcloud builds triggers create github \
  --project=dina-pm \
  --name=dina-main \
  --repo-owner=bsa717a \
  --repo-name=dina \
  --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --service-account='projects/dina-pm/serviceAccounts/dina-cloudbuild@dina-pm.iam.gserviceaccount.com' \
  --description='On push to main, build and deploy Cloud Run service dina, then send 100% traffic to the latest revision'
```

Console alternative, which is clicks: **Create trigger**, event **Push to a branch**, source `bsa717a/dina`, branch `^main$`, configuration **Cloud Build configuration file** `/cloudbuild.yaml`, service account `dina-cloudbuild@dina-pm.iam.gserviceaccount.com`, then **Create**.

The next push to `main` after the trigger exists is what deploys. Creating the trigger does not deploy by itself.

If a new revision fails to start because Cloud Run cannot pull the image, grant the Cloud Run service agent `roles/artifactregistry.reader` on repository `dina`. Do that only in that case. Do not delete or rebind secrets to fix a pull error.
