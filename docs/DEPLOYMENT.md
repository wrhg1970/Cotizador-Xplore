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

## Google

En la consola de Google Cloud, en el cliente OAuth, registrar como URI de redirección autorizada:

```
${API_PUBLIC_URL}/api/v1/auth/google/callback
```

Con dominio compartido, el balanceador o CDN enruta todo al servicio `web`; la API solo necesita ser accesible desde `web`, salvo `/api/v1/auth/google/callback`, que pasa por el mismo reenvío `/api`.
