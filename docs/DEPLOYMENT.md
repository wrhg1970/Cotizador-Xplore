# Despliegue

El `Dockerfile` produce tres imágenes y sirve en cualquier proveedor que corra contenedores con Postgres administrado (mismo esquema que Trip360).

| Target    | Qué hace                                       | Puerto |
| --------- | ---------------------------------------------- | ------ |
| `migrate` | Aplica migraciones (`prisma migrate deploy`)   | —      |
| `api`     | API NestJS, healthcheck en `/api/v1/health`    | 4000   |
| `web`     | Next.js standalone; reenvía `/api` a la API    | 3000   |

```sh
docker build --target migrate -t cotizador-migrate .
docker build --target api -t cotizador-api .
docker build --target web --build-arg API_ORIGIN=http://<api-interna>:4000 -t cotizador-web .
```

`API_ORIGIN` se fija al construir la imagen web: es la dirección interna de la API a la que Next.js reenvía `/api`.

## Orden de arranque

1. Correr `migrate` con `DATABASE_URL` en cada despliegue, antes de la API.
2. Arrancar `api` y `web`.
3. La primera vez, crear el primer administrador con `pnpm --filter @ee/db seed` (variables `SEED_*`).

## Variables de la API

Todas van en el gestor de secretos del proveedor, nunca en la imagen ni en el repositorio.

- `DATABASE_URL`
- `NODE_ENV=production`
- `API_PUBLIC_URL` y `WEB_ORIGIN`: la URL pública, por ejemplo `https://cotizador.estudiantesembajadores.com` en ambas si web y API comparten dominio (recomendado).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `ALLOWED_GOOGLE_DOMAINS`: dominios de Google Workspace separados por coma.
- `SESSION_SECRET`: `openssl rand -hex 32`.
- `VERTEX_PROJECT` (opcional): proyecto de Google Cloud para el importador con IA; sin él, el importador responde 503. `VERTEX_LOCATION` (por defecto `global`) y `VERTEX_MODEL` (por defecto `gemini-3.8-flash`). `deploy.sh` lo configura solo y da a la cuenta de servicio el rol `roles/aiplatform.user`.
- Avisos por correo (opcional): `SMTP_HOST`, `SMTP_PORT` (465 por defecto; otro puerto exige STARTTLS), `SMTP_USER`, `SMTP_PASSWORD` y `MAIL_FROM` (por defecto `SMTP_USER`). Sin host, usuario o contraseña los avisos quedan apagados y el flujo funciona igual.

## Cuenta de correo para los avisos

Will eligió una cuenta dedicada de Google Workspace (por ejemplo `cotizador@estudiantesembajadores.com`) enviando por SMTP de Gmail:

1. Crear la cuenta en la Consola de administración de Google Workspace.
2. Activarle la verificación en 2 pasos y crear una **contraseña de aplicación** (Cuenta de Google → Seguridad → Contraseñas de aplicaciones). Si la opción no aparece, el administrador debe permitir la verificación en 2 pasos para esa cuenta.
3. Desplegar con `SMTP_USER=cotizador@estudiantesembajadores.com` además de las variables de siempre. La primera vez `deploy.sh` pide la contraseña de aplicación sin mostrarla y la guarda en Secret Manager (`cotizador-smtp-password`). Hay que pasar `SMTP_USER` en cada despliegue: si falta, los avisos se apagan.

Para cambiar la contraseña: `printf '%s' '<nueva>' | gcloud secrets versions add cotizador-smtp-password --data-file=-` y volver a desplegar.

## Google

En la consola de Google Cloud, en el cliente OAuth, registrar como URI de redirección autorizada:

```
${API_PUBLIC_URL}/api/v1/auth/google/callback
```

Con dominio compartido, el balanceador o CDN enruta todo al servicio `web`; la API solo necesita ser accesible desde `web`, salvo `/api/v1/auth/google/callback`, que pasa por el mismo reenvío `/api`.

## Google Cloud

`infra/gcp/deploy.sh` crea y actualiza todo con `gcloud`: Cloud SQL Postgres 16 con respaldos, Artifact Registry, Secret Manager, el job de migraciones y los servicios `cotizador-api` y `cotizador-web` en Cloud Run. Se puede volver a correr para cada versión nueva.

```sh
gcloud auth login
PROJECT_ID=<id-del-proyecto> ALLOWED_GOOGLE_DOMAINS=estudiantesembajadores.com \
  SEED_OFFICE_CODE=MX SEED_OFFICE_NAME="México" \
  SEED_ADMIN_EMAIL=<correo> SEED_ADMIN_NAME="<nombre>" \
  infra/gcp/deploy.sh
```

- El proyecto necesita facturación activa. La región por defecto es `us-central1` (`REGION=` para cambiarla).
- La primera vez pide el client secret de Google sin mostrarlo y lo guarda en Secret Manager; la clave de base de datos y `SESSION_SECRET` se generan solos.
- Las variables `SEED_*` son opcionales; solo hacen falta la primera vez.
- Al final imprime la URL y la URI de redirección que hay que registrar en el cliente OAuth. Con dominio propio, mapearlo a `cotizador-web` y volver a correr con `PUBLIC_URL=https://<dominio>`.
