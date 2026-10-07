# Production deploy (Cloud Build → Cloud Run)

A push to `main` builds and deploys Cloud Run service `dina` in project `dina-pm`, region `us-central1`. The trigger runs as `dina-cloudbuild@dina-pm.iam.gserviceaccount.com`. There is no downloadable key and no personal `gcloud auth login`.

Config: [`cloudbuild.yaml`](../cloudbuild.yaml).

The trigger is regional, in `us-central1`, on the existing Cloud Build connection `Piper-Dina`. Do not create another connection.

What a push does:

1. Google Cloud Buildpacks build the image with `gcr.io/buildpacks/builder:latest` (google-24). That is the builder `gcloud run deploy --source` uses. This repo has no Dockerfile. The build pins Node 22 (`GOOGLE_RUNTIME_VERSION=22`). google-24 supports Node 22, which is the Node major of the Cloud Run image defined for service `dina` (`node:22`) and the version this app recommends. Unpinned `builder:latest` would select the newest Node on google-24.
2. The image is pushed to the existing Artifact Registry repository `us-central1-docker.pkg.dev/dina-pm/dina/dina`.
3. `gcloud run deploy --no-traffic` ships that image as a new revision and does not move traffic.
4. The build reads the current head of `main` through connection `Piper-Dina`. It runs `gcloud run services update-traffic dina --to-latest` only when `$COMMIT_SHA` is still that head. That sends 100% of traffic to the revision just deployed. If `main` has moved, the build stops and leaves traffic where it is.

The deploy command does not pass `--set-env-vars`, `--clear-env-vars`, `--set-secrets`, `--update-secrets`, `--remove-secrets`, or `--clear-secrets`. Existing Cloud Run environment variables, Secret Manager mounts, and Cloud SQL settings stay as they are. Do not delete secrets.

The build does not run `prisma migrate`. `npm start` is unchanged (`next start` on port 8080). The Cloud Run container port for `dina` needs to stay 8080.

`deploy/com.dina.app.plist` is not the production deploy. Do not load it to ship Dina.

## One-time setup (not in git)

A person does these once, in this order. This repository cannot do them. Do not create a service account key. Do not create a Cloud Build connection. `Piper-Dina` already exists in `us-central1`.

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

# Deploy and shift traffic only for Cloud Run service dina in us-central1.
# run.services.update is checked against the service. gcloud also polls
# run.operations.get on regional operation resources, and some clients still
# check namespaces/dina-pm/services/dina. Those names are included so deploy
# can finish. This role still cannot update any other Cloud Run service.
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.developer" \
  --condition='expression=resource.name.startsWith("projects/dina-pm/locations/us-central1/services/dina") || resource.name.startsWith("projects/dina-pm/locations/us-central1/operations/") || resource.name=="namespaces/dina-pm/services/dina",title=dina-us-central1,description=Deploy only Cloud Run service dina in us-central1'

# Let gcloud check that the Run API is enabled.
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/serviceusage.serviceUsageConsumer"

# Read main's head through the existing Piper-Dina connection only.
# The traffic step uses this to refuse an older commit. The token is not printed.
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudbuild.readTokenAccessor" \
  --condition='expression=resource.name.startsWith("projects/dina-pm/locations/us-central1/connections/Piper-Dina"),title=piper-dina-read-token,description=Read tokens only for the Piper-Dina connection'
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

### 3. Finish GitHub authorization and link the repo — a person must click

Connection `Piper-Dina` in `us-central1` already exists. Do not create a connection. `gcloud` cannot finish the GitHub authorization.

1. Open [Cloud Build connections for `dina-pm`](https://console.cloud.google.com/cloud-build/connections?project=dina-pm) and select region `us-central1`.
2. Open connection **Piper-Dina**.
3. Click through the remaining GitHub authorization for that connection.
4. Link repository `bsa717a/dina`.
5. Copy the linked repository id (the last segment of `projects/dina-pm/locations/us-central1/connections/Piper-Dina/repositories/<linked repo>`).

This list shows the same id after the link exists:

```bash
gcloud builds repositories list \
  --project=dina-pm \
  --region=us-central1 \
  --connection=Piper-Dina
```

### 4. Create the trigger on pushes to `main`

No browser click if you use this command. Run it after step 3. Region is `us-central1`. Replace `<linked repo>` with the id from step 3. The service account is the email below.

```bash
gcloud builds triggers create github \
  --project=dina-pm \
  --name=dina-main \
  --region=us-central1 \
  --repository='projects/dina-pm/locations/us-central1/connections/Piper-Dina/repositories/<linked repo>' \
  --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --service-account='dina-cloudbuild@dina-pm.iam.gserviceaccount.com' \
  --substitutions=_LINKED_REPO='<linked repo>' \
  --description='On push to main, build and deploy Cloud Run service dina, then send 100% traffic to the latest revision when that commit is still the head of main'
```

`--substitutions=_LINKED_REPO` overrides the placeholder in `cloudbuild.yaml`. The traffic step calls `accessReadToken` on `projects/dina-pm/locations/us-central1/connections/Piper-Dina/repositories/<linked repo>` and moves traffic only when that repository's `main` head equals `$COMMIT_SHA`.

Console alternative, which is clicks: **Create trigger** in region `us-central1`, event **Push to a branch**, source connection **Piper-Dina** repository `<linked repo>`, branch `^main$`, configuration **Cloud Build configuration file** `/cloudbuild.yaml`, substitution `_LINKED_REPO` = `<linked repo>`, service account `dina-cloudbuild@dina-pm.iam.gserviceaccount.com`, then **Create**.

Creating the trigger does not deploy. The next push to `main` after the trigger exists is what deploys.

If a new revision fails to start because Cloud Run cannot pull the image, grant the Cloud Run service agent `roles/artifactregistry.reader` on repository `dina`. Do that only in that case. Do not delete or rebind secrets to fix a pull error.

**Must click:** step 3 (finish GitHub authorization on `Piper-Dina` and link `bsa717a/dina`). Steps 1, 2, and 4 are gcloud. Step 4 is clicks only if you use the console instead of the command above.
