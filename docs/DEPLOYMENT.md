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
- `ALLOWED_GOOGLE_DOMAINS`: dominios de Google Workspace de Estudiantes Embajadores, separados por coma (los de otras agencias se registran en Administración → Agencias).
- `SESSION_SECRET`: `openssl rand -hex 32`.
- `VERTEX_PROJECT` (opcional): proyecto de Google Cloud para el importador con IA; sin él, el importador responde 503. `VERTEX_LOCATION` (por defecto `global`) y `VERTEX_MODEL` (por defecto `gemini-3.8-flash`). `deploy.sh` lo configura solo y da a la cuenta de servicio el rol `roles/aiplatform.user`.
- Avisos por correo (opcional): `SMTP_HOST`, `SMTP_PORT` (465 por defecto; otro puerto exige STARTTLS), `SMTP_USER`, `SMTP_PASSWORD` y `MAIL_FROM` (por defecto `SMTP_USER`). Sin host, usuario o contraseña los avisos quedan apagados y el flujo funciona igual.
- `BANXICO_TOKEN` (opcional): token del SIE de Banxico para traer USD/MXN (FIX, serie SF43718) y EUR/MXN (SF46410) como tipos de cambio oficiales. Sin él, solo se capturan a mano.
- `CRON_SECRET` (opcional, 32+ caracteres): secreto que Cloud Scheduler manda en `X-Cron-Secret` a `POST /api/v1/cron/daily`. Sin él la ruta responde 404. `deploy.sh` lo genera y crea la tarea diaria.

## Tipo de cambio de Banxico

1. Pedir el token gratuito en https://www.banxico.org.mx/SieAPIRest/service/v1/token (correo y captcha; llega al instante).
2. Desplegar una vez con `BANXICO=1` además de las variables de siempre; `deploy.sh` pide el token sin mostrarlo y lo guarda en `cotizador-banxico-token`. Los despliegues siguientes lo toman solos.
3. La tarea `cotizador-daily` (o `cotizador-prod-daily`) corre de lunes a viernes a las 13:00 de CDMX, después de que Banxico publica el FIX, y publica el tipo nuevo solo si cambió la fecha. Si Banxico falla, sigue vigente el último publicado. En Administración, "Traer de Banxico ahora" hace lo mismo a mano.

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

## Login de otras agencias (consentimiento de Google Externo)

Cada agencia entra con las cuentas de Google Workspace de sus propios dominios, que se registran en Administración → Agencias (solo para administradores del sistema de EE). `ALLOWED_GOOGLE_DOMAINS` sigue siendo la lista de dominios de Estudiantes Embajadores, que se suma a los de su agencia; las demás agencias no usan esa variable.

Hoy la pantalla de consentimiento OAuth del proyecto está en **Interno**, así que Google solo deja entrar cuentas de la organización de Workspace dueña del proyecto. Antes de dar de alta la primera agencia de otra organización:

1. Google Cloud Console → APIs y servicios → Pantalla de consentimiento de OAuth (Google Auth Platform → Audiencia) → Tipo de usuario: **Externo**.
2. Estado de publicación: **En producción**. En «Prueba» solo entran hasta 100 usuarios de prueba agregados a mano y la sesión de Google caduca a los 7 días.
3. Completar nombre de la app, logo, correo de soporte, dominios autorizados (`xploretogether.travel` y los dominios propios de las agencias) y las ligas de política de privacidad y términos de servicio.
4. Alcances: solo `openid`, `email` y `profile`. No son sensibles, así que Google no exige una revisión de seguridad, pero sí puede pedir verificar la marca (nombre y logo, unos días). Mientras no esté verificada, los usuarios ven el aviso «Google no verificó esta app».

Qué cambia y qué no:
- Con «Externo», Google deja pasar cualquier cuenta. El cotizador sigue rechazando a quien no tenga un correo invitado de un dominio de su agencia con el claim `hd` de Workspace (las cuentas de Gmail no entran).
- Los usuarios de EE no notan diferencia, salvo, si acaso, una pantalla de consentimiento la primera vez.
- Siguiente paso, no incluido: agencias sin Google Workspace (correo y contraseña, o Microsoft Entra ID). Requiere otro proveedor OIDC en `auth/oidc.ts`, verificar el correo por enlace y, para contraseñas, hash Argon2 con límite de intentos.

## Dominio propio de una agencia

En Administración → Marca cada agencia puede poner su dominio (por ejemplo `cotizador.agencia.com`). Antes de guardarlo:

1. La agencia crea en su DNS el registro que indique Google Cloud.
2. En Cloud Run, Domain mappings, mapear ese dominio al servicio web del ambiente (`cotizador-web-prod` en producción).
3. Registrar en el cliente OAuth la URI `https://cotizador.agencia.com/api/v1/auth/google/callback` (necesaria para entrar desde ese dominio).

Con el dominio guardado, las ligas de los correos de esa agencia apuntan a él, y la pantalla de inicio de sesión muestra su logo y colores cuando se abre desde ahí.

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
- Al final imprime la URL y la URI de redirección que hay que registrar en el cliente OAuth. El dominio propio se mapea a producción (ver abajo).

## Respaldos
`deploy.sh` deja la instancia de Cloud SQL con respaldo diario (08:00 UTC) guardado 30 días, recuperación a un punto en el tiempo de 7 días y protección contra borrado. Staging y producción comparten instancia, así que el mismo respaldo cubre ambas bases. Para restaurar: Cloud SQL → instancia `cotizador-db` → Respaldos → Restaurar (o "Clonar a un punto en el tiempo" para recuperar sin tocar la instancia viva). Los respaldos se borran si se elimina la instancia; la protección contra borrado lo evita.

## Monitoreo
Agregar `ALERT_EMAIL=persona@estudiantesembajadores.com` al deploy (una vez por ambiente basta). Crea en Cloud Monitoring:
- Revisiones de disponibilidad cada 5 minutos: `cotizador[-prod]-web` (`/login` del servicio web) y `cotizador[-prod]-api` (`/api/v1/health/ready`, que también prueba la base de datos).
- Una política de alerta por revisión que manda correo a `ALERT_EMAIL` cuando falla desde más de una región.
Se ve todo en Monitoring → Uptime checks.

## Producción separada de staging

`deploy.sh` acepta `ENV=staging|prod` (por defecto `staging`). Los dos entornos viven en el mismo proyecto y la misma instancia de Cloud SQL, pero con datos y sesiones separados:

| | staging | prod |
|---|---|---|
| Servicios Cloud Run | `cotizador-api`, `cotizador-web` | `cotizador-api-prod`, `cotizador-web-prod` |
| Jobs | `cotizador-migrate`, `cotizador-seed` | `cotizador-migrate-prod`, `cotizador-seed-prod` |
| Base de datos / usuario | `ee_quotes` / `ee_app` | `ee_quotes_prod` / `ee_app_prod` |
| Secretos propios | `cotizador-database-url`, `cotizador-session-secret` | `cotizador-prod-database-url`, `cotizador-prod-session-secret` |
| `PUBLIC_URL` por defecto | URL run.app de `cotizador-web` | `https://cotizador.xploretogether.travel` |

Se comparten el cliente OAuth, la contraseña SMTP y la llave de WeTravel. Staging deja de llevar `PUBLIC_URL` con el dominio: el dominio es de producción.

Primer despliegue de producción (crea la BD vacía, corre migraciones y da de alta al primer administrador):

```sh
cd ~/Cotizador-Xplore && git pull
ENV=prod PROJECT_ID=xploretogether-cotizador \
ALLOWED_GOOGLE_DOMAINS=estudiantesembajadores.com \
SMTP_USER=cotizador@estudiantesembajadores.com \
SEED_OFFICE_CODE=CORP SEED_OFFICE_NAME="Corporativo Nuevo León" \
SEED_ADMIN_EMAIL=<correo-del-admin> SEED_ADMIN_NAME="<nombre>" \
infra/gcp/deploy.sh
```

Después, mapear el dominio al servicio de producción (si ya estaba mapeado a staging, borrar ese mapeo primero):

```sh
gcloud beta run domain-mappings delete --domain=cotizador.xploretogether.travel --region=us-central1   # solo si existía
gcloud beta run domain-mappings create --service=cotizador-web-prod \
  --domain=cotizador.xploretogether.travel --region=us-central1
```

Despliegues siguientes: el mismo comando sin las variables `SEED_*`. Staging se sigue desplegando igual que antes, sin `ENV` ni `PUBLIC_URL`. Lo normal es probar primero en staging y luego correr el mismo commit con `ENV=prod`.
