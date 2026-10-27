#!/usr/bin/env bash
# Despliega el cotizador en Google Cloud: Cloud Run (api, web, job de migraciones),
# Cloud SQL Postgres, Secret Manager y Artifact Registry. Se puede volver a correr:
# los pasos de creación se saltan si el recurso ya existe.
#
# Uso: PROJECT_ID=... ALLOWED_GOOGLE_DOMAINS=a.com,b.com infra/gcp/deploy.sh
set -euo pipefail

: "${PROJECT_ID:?Falta PROJECT_ID}"
: "${ALLOWED_GOOGLE_DOMAINS:?Falta ALLOWED_GOOGLE_DOMAINS}"
REGION="${REGION:-us-central1}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-396960829901-db14jbmb6o3l0j6hdav3vaqdolbsqoc2.apps.googleusercontent.com}"
DB_INSTANCE=cotizador-db
DB_NAME=ee_quotes
DB_USER=ee_app
REPO="$REGION-docker.pkg.dev/$PROJECT_ID/cotizador"
TAG="$(git rev-parse --short HEAD)"

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
# URL que Cloud Run asigna al servicio web; con dominio propio, pasar PUBLIC_URL.
PUBLIC_URL="${PUBLIC_URL:-https://cotizador-web-$PROJECT_NUMBER.$REGION.run.app}"
API_URL="https://cotizador-api-$PROJECT_NUMBER.$REGION.run.app"
CONN="$PROJECT_ID:$REGION:$DB_INSTANCE"

exists() { "$@" >/dev/null 2>&1; }

secret() { # secret <nombre> : lee el valor de stdin
  if exists gcloud secrets describe "$1"; then
    gcloud secrets versions add "$1" --data-file=- >/dev/null
  else
    gcloud secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null
  fi
}

echo "== APIs"
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  aiplatform.googleapis.com

echo "== Artifact Registry"
exists gcloud artifacts repositories describe cotizador --location="$REGION" ||
  gcloud artifacts repositories create cotizador --repository-format=docker --location="$REGION"

echo "== Cloud SQL (tarda varios minutos la primera vez)"
exists gcloud sql instances describe "$DB_INSTANCE" ||
  gcloud sql instances create "$DB_INSTANCE" --database-version=POSTGRES_16 \
    --edition=enterprise --tier=db-g1-small --region="$REGION" \
    --backup-start-time=08:00 --enable-point-in-time-recovery
exists gcloud sql databases describe "$DB_NAME" --instance="$DB_INSTANCE" ||
  gcloud sql databases create "$DB_NAME" --instance="$DB_INSTANCE"

echo "== Secretos"
if ! exists gcloud secrets describe cotizador-database-url; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  gcloud sql users create "$DB_USER" --instance="$DB_INSTANCE" --password="$DB_PASSWORD"
  printf 'postgresql://%s:%s@localhost/%s?host=/cloudsql/%s' "$DB_USER" "$DB_PASSWORD" "$DB_NAME" "$CONN" |
    secret cotizador-database-url
fi
exists gcloud secrets describe cotizador-session-secret ||
  openssl rand -hex 32 | tr -d '\n' | secret cotizador-session-secret
if ! exists gcloud secrets describe cotizador-google-client-secret; then
  read -rsp "Client secret de Google OAuth (no se muestra): " GOOGLE_CLIENT_SECRET && echo
  printf '%s' "$GOOGLE_CLIENT_SECRET" | secret cotizador-google-client-secret
fi
# Cloud Build usa la misma cuenta de servicio en proyectos nuevos y ya no recibe permisos automáticos.
# aiplatform.user: the sheet importer calls Gemini on Vertex AI with this account, no API keys.
for role in roles/secretmanager.secretAccessor roles/cloudsql.client roles/cloudbuild.builds.builder roles/aiplatform.user; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" \
    --role="$role" --condition=None >/dev/null
done

build() { # build <target> [api_origin]
  gcloud builds submit --config infra/gcp/cloudbuild.yaml \
    --substitutions="_IMAGE=$REPO/$1:$TAG,_TARGET=$1,_API_ORIGIN=${2:-http://localhost:4000}" .
}

echo "== Imágenes"
build migrate
build api
build web "$API_URL"

echo "== Migraciones"
gcloud run jobs deploy cotizador-migrate --image="$REPO/migrate:$TAG" --region="$REGION" \
  --set-cloudsql-instances="$CONN" --set-secrets=DATABASE_URL=cotizador-database-url:latest
gcloud run jobs execute cotizador-migrate --region="$REGION" --wait

if [[ -n "${SEED_ADMIN_EMAIL:-}" ]]; then
  echo "== Primer administrador"
  gcloud run jobs deploy cotizador-seed --image="$REPO/migrate:$TAG" --region="$REGION" \
    --set-cloudsql-instances="$CONN" --set-secrets=DATABASE_URL=cotizador-database-url:latest \
    --command=pnpm --args=--filter,@ee/db,seed \
    --set-env-vars="^|^SEED_OFFICE_CODE=${SEED_OFFICE_CODE:?}|SEED_OFFICE_NAME=${SEED_OFFICE_NAME:?}|SEED_ADMIN_EMAIL=$SEED_ADMIN_EMAIL|SEED_ADMIN_NAME=${SEED_ADMIN_NAME:?}"
  gcloud run jobs execute cotizador-seed --region="$REGION" --wait
fi

echo "== API"
# shortcut: la API queda pública para que web la alcance sin tokens de servicio;
# las rutas ya exigen sesión. Pasar a ingress interno + VPC cuando haya más tráfico.
gcloud run deploy cotizador-api --image="$REPO/api:$TAG" --region="$REGION" --port=4000 \
  --allow-unauthenticated --add-cloudsql-instances="$CONN" \
  --set-env-vars="^|^NODE_ENV=production|API_PUBLIC_URL=$PUBLIC_URL|WEB_ORIGIN=$PUBLIC_URL|ALLOWED_GOOGLE_DOMAINS=$ALLOWED_GOOGLE_DOMAINS|GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID|VERTEX_PROJECT=$PROJECT_ID" \
  --set-secrets=DATABASE_URL=cotizador-database-url:latest,SESSION_SECRET=cotizador-session-secret:latest,GOOGLE_CLIENT_SECRET=cotizador-google-client-secret:latest

echo "== Web"
gcloud run deploy cotizador-web --image="$REPO/web:$TAG" --region="$REGION" --port=3000 \
  --allow-unauthenticated

echo
echo "Listo: $PUBLIC_URL"
echo "URI de redirección para Google OAuth: $PUBLIC_URL/api/v1/auth/google/callback"
