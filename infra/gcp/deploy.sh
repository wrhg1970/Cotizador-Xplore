#!/usr/bin/env bash
# Despliega el cotizador en Google Cloud: Cloud Run (api, web, job de migraciones),
# Cloud SQL Postgres, Secret Manager y Artifact Registry. Se puede volver a correr:
# los pasos de creación se saltan si el recurso ya existe.
#
# Uso: PROJECT_ID=... ALLOWED_GOOGLE_DOMAINS=a.com,b.com [ENV=staging|prod] infra/gcp/deploy.sh
# ENV=staging (por defecto) usa los nombres de siempre (cotizador-api, cotizador-web, BD ee_quotes).
# ENV=prod crea un juego aparte en el mismo proyecto e instancia: servicios *-prod, BD ee_quotes_prod
# y secretos de BD/sesión propios; el cliente OAuth, SMTP y WeTravel se comparten. Su PUBLIC_URL
# por defecto es https://cotizador.xploretogether.travel.
# Avisos por correo (opcional): agregar SMTP_USER=cuenta@dominio en cada despliegue;
# la primera vez pide la contraseña de aplicación de esa cuenta. Sin SMTP_USER quedan apagados.
# WeTravel (opcional): la primera vez correr con WETRAVEL=1 para guardar la llave de la Partner API;
# después se conecta sola mientras exista el secreto. WETRAVEL_API_URL apunta al sandbox si se quiere.
# Banxico (opcional): la primera vez correr con BANXICO=1 para guardar el token del SIE; igual que WeTravel.
# Siempre crea la tarea diaria de Cloud Scheduler (días hábiles, 13:00 hora de CDMX) que llama a /cron/daily.
set -euo pipefail

: "${PROJECT_ID:?Falta PROJECT_ID}"
: "${ALLOWED_GOOGLE_DOMAINS:?Falta ALLOWED_GOOGLE_DOMAINS}"
REGION="${REGION:-us-central1}"
ENV="${ENV:-staging}"
case "$ENV" in
  staging) SUFFIX="" ;;
  prod) SUFFIX="-prod" ;;
  *) echo "ENV debe ser staging o prod" >&2; exit 1 ;;
esac
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-396960829901-db14jbmb6o3l0j6hdav3vaqdolbsqoc2.apps.googleusercontent.com}"
DB_INSTANCE=cotizador-db
DB_NAME="ee_quotes${SUFFIX//-/_}"
DB_USER="ee_app${SUFFIX//-/_}"
REPO="$REGION-docker.pkg.dev/$PROJECT_ID/cotizador"
TAG="$(git rev-parse --short HEAD)"

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
# URL que Cloud Run asigna al servicio web; con dominio propio, pasar PUBLIC_URL.
if [[ "$ENV" == prod ]]; then DEFAULT_URL=https://cotizador.xploretogether.travel
else DEFAULT_URL="https://cotizador-web-$PROJECT_NUMBER.$REGION.run.app"; fi
PUBLIC_URL="${PUBLIC_URL:-$DEFAULT_URL}"
API_URL="https://cotizador-api$SUFFIX-$PROJECT_NUMBER.$REGION.run.app"
DB_SECRET="cotizador${SUFFIX}-database-url"
SESSION_SECRET_NAME="cotizador${SUFFIX}-session-secret"
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
  aiplatform.googleapis.com cloudscheduler.googleapis.com

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
if ! exists gcloud secrets describe "$DB_SECRET"; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  gcloud sql users create "$DB_USER" --instance="$DB_INSTANCE" --password="$DB_PASSWORD"
  printf 'postgresql://%s:%s@localhost/%s?host=/cloudsql/%s' "$DB_USER" "$DB_PASSWORD" "$DB_NAME" "$CONN" |
    secret "$DB_SECRET"
fi
exists gcloud secrets describe "$SESSION_SECRET_NAME" ||
  openssl rand -hex 32 | tr -d '\n' | secret "$SESSION_SECRET_NAME"
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

build() { # build <target> [api_origin] [image]
  gcloud builds submit --config infra/gcp/cloudbuild.yaml \
    --substitutions="_IMAGE=$REPO/${3:-$1}:$TAG,_TARGET=$1,_API_ORIGIN=${2:-http://localhost:4000}" .
}

echo "== Imágenes"
build migrate
build api
# web lleva la URL de la API dentro de la imagen, por eso es una imagen por entorno.
build "web" "$API_URL" "web$SUFFIX"

echo "== Migraciones"
gcloud run jobs deploy "cotizador-migrate$SUFFIX" --image="$REPO/migrate:$TAG" --region="$REGION" \
  --set-cloudsql-instances="$CONN" --set-secrets=DATABASE_URL=$DB_SECRET:latest
gcloud run jobs execute "cotizador-migrate$SUFFIX" --region="$REGION" --wait

if [[ -n "${SEED_ADMIN_EMAIL:-}" ]]; then
  echo "== Primer administrador"
  gcloud run jobs deploy "cotizador-seed$SUFFIX" --image="$REPO/migrate:$TAG" --region="$REGION" \
    --set-cloudsql-instances="$CONN" --set-secrets=DATABASE_URL=$DB_SECRET:latest \
    --command=pnpm --args=--filter,@ee/db,seed \
    --set-env-vars="^|^SEED_OFFICE_CODE=${SEED_OFFICE_CODE:?}|SEED_OFFICE_NAME=${SEED_OFFICE_NAME:?}|SEED_ADMIN_EMAIL=$SEED_ADMIN_EMAIL|SEED_ADMIN_NAME=${SEED_ADMIN_NAME:?}"
  gcloud run jobs execute "cotizador-seed$SUFFIX" --region="$REGION" --wait
fi

MAIL_ENV=""
MAIL_SECRETS=""
if [[ -n "${SMTP_USER:-}" ]]; then
  if ! exists gcloud secrets describe cotizador-smtp-password; then
    read -rsp "Contraseña de aplicación de $SMTP_USER (no se muestra): " SMTP_PASSWORD && echo
    printf '%s' "$SMTP_PASSWORD" | secret cotizador-smtp-password
  fi
  MAIL_ENV="|SMTP_HOST=${SMTP_HOST:-smtp.gmail.com}|SMTP_USER=$SMTP_USER|MAIL_FROM=Cotizador EE <$SMTP_USER>"
  MAIL_SECRETS=",SMTP_PASSWORD=cotizador-smtp-password:latest"
fi

WT_ENV=""
WT_SECRETS=""
if [[ -n "${WETRAVEL:-}" ]] && ! exists gcloud secrets describe cotizador-wetravel-api-key; then
  read -rsp "Llave de la Partner API de WeTravel (no se muestra): " WETRAVEL_API_KEY && echo
  printf '%s' "$WETRAVEL_API_KEY" | secret cotizador-wetravel-api-key
fi
if exists gcloud secrets describe cotizador-wetravel-api-key; then
  WT_ENV="|WETRAVEL_API_URL=${WETRAVEL_API_URL:-https://api.wetravel.com/v3}"
  WT_SECRETS=",WETRAVEL_API_KEY=cotizador-wetravel-api-key:latest"
fi

BMX_ENV=""
if [[ -n "${BANXICO:-}" ]] && ! exists gcloud secrets describe cotizador-banxico-token; then
  read -rsp "Token del SIE de Banxico (no se muestra): " BANXICO_TOKEN && echo
  printf '%s' "$BANXICO_TOKEN" | secret cotizador-banxico-token
fi
exists gcloud secrets describe cotizador-banxico-token && BMX_ENV=",BANXICO_TOKEN=cotizador-banxico-token:latest"

CRON_SECRET_NAME="cotizador${SUFFIX}-cron-secret"
exists gcloud secrets describe "$CRON_SECRET_NAME" ||
  openssl rand -hex 32 | tr -d '\n' | secret "$CRON_SECRET_NAME"

echo "== API"
# shortcut: la API queda pública para que web la alcance sin tokens de servicio;
# las rutas ya exigen sesión. Pasar a ingress interno + VPC cuando haya más tráfico.
gcloud run deploy "cotizador-api$SUFFIX" --image="$REPO/api:$TAG" --region="$REGION" --port=4000 \
  --allow-unauthenticated --add-cloudsql-instances="$CONN" \
  --set-env-vars="^|^NODE_ENV=production|API_PUBLIC_URL=$PUBLIC_URL|WEB_ORIGIN=$PUBLIC_URL|ALLOWED_GOOGLE_DOMAINS=$ALLOWED_GOOGLE_DOMAINS|GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID|VERTEX_PROJECT=$PROJECT_ID$MAIL_ENV$WT_ENV" \
  --set-secrets=DATABASE_URL=$DB_SECRET:latest,SESSION_SECRET=$SESSION_SECRET_NAME:latest,GOOGLE_CLIENT_SECRET=cotizador-google-client-secret:latest,CRON_SECRET=$CRON_SECRET_NAME:latest$MAIL_SECRETS$WT_SECRETS$BMX_ENV

echo "== Web"
gcloud run deploy "cotizador-web$SUFFIX" --image="$REPO/web$SUFFIX:$TAG" --region="$REGION" --port=3000 \
  --allow-unauthenticated

echo "== Tarea diaria (Banxico y avisos)"
# shortcut: el secreto viaja como header y queda visible para quien vea la tarea en el proyecto;
# pasar a token OIDC de Cloud Scheduler si el proyecto se abre a más personas.
CRON_ARGS=(--location="$REGION" --schedule="0 13 * * 1-5" --time-zone="America/Mexico_City"
  --uri="$API_URL/api/v1/cron/daily" --http-method=POST
  --headers="X-Cron-Secret=$(gcloud secrets versions access latest --secret="$CRON_SECRET_NAME")")
if exists gcloud scheduler jobs describe "cotizador$SUFFIX-daily" --location="$REGION"; then
  gcloud scheduler jobs update http "cotizador$SUFFIX-daily" "${CRON_ARGS[@]/--headers=/--update-headers=}" >/dev/null
else
  gcloud scheduler jobs create http "cotizador$SUFFIX-daily" "${CRON_ARGS[@]}" >/dev/null
fi

echo
echo "Listo ($ENV): $PUBLIC_URL"
echo "URI de redirección para Google OAuth: $PUBLIC_URL/api/v1/auth/google/callback"
