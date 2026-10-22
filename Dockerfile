# syntax=docker/dockerfile:1.7
# One build, three images (same layout as Trip360: containerized API, migrations as a one-off job):
#   docker build --target api .      → API (NestJS)
#   docker build --target web --build-arg API_ORIGIN=http://api:4000 .  → web (Next.js standalone)
#   docker build --target migrate .  → runs `prisma migrate deploy` (and `seed`) against DATABASE_URL
FROM node:22.20.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Next bakes rewrites at build time, so the API address is a build argument (not a secret).
ARG API_ORIGIN=http://localhost:4000
ENV API_ORIGIN=$API_ORIGIN NEXT_OUTPUT=standalone
RUN pnpm build

FROM build AS migrate
USER node
CMD ["pnpm", "--filter", "@ee/db", "migrate:deploy"]

FROM build AS prod-deps
RUN pnpm install --prod --frozen-lockfile --offline

# shortcut: ships the whole pruned workspace (web deps included); use `turbo prune` if image size matters.
FROM base AS api
ENV NODE_ENV=production API_PORT=4000
COPY --from=prod-deps --chown=node:node /app /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.API_PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

FROM node:22.20.0-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
