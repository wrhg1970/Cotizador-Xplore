# Cotizador y Administrador de Propuestas — Estudiantes Embajadores

Paquete de arranque para desarrollar con Claude Code. El sistema administra solicitudes de viajes grupales, escenarios de cotización, aprobaciones obligatorias, envío de propuestas, aceptación/rechazo e integración futura con XploreTogether.

## Decisiones de producto confirmadas
- Usuarios: asesores de oficinas y equipo cotizador.
- Aprobación: toda cotización requiere aprobación antes de enviarse.
- Documentos: PDF comercial para cliente y Excel interno con costos/márgenes.
- Integraciones: preparar e intentar conectar WeTravel y Wissify desde la primera versión, sujeto a API, credenciales y permisos disponibles; preparar contrato de integración con XploreTogether para una fase posterior.
- Autenticación: cuentas corporativas Google.
- Multi-oficina y control por roles.
- Moneda y fórmulas configurables; conservar versiones inmutables de propuestas enviadas.

## Cómo empezar
1. Descomprime este paquete en la raíz del repositorio.
2. Abre Claude Code desde esa carpeta.
3. Pide: `Lee CLAUDE.md y los documentos del proyecto. Revisa el repositorio y propone un plan de implementación para Sprint 0. No escribas código hasta presentar riesgos, decisiones pendientes y el plan.`
4. Confirma el plan y trabaja sprint por sprint.
5. Copia `.env.example` a `.env` y configura secretos solo en tu entorno local/gestor de secretos. Nunca subas `.env`.

## Estructura sugerida
```text
apps/
  web/                 # Next.js + TypeScript
  api/                 # NestJS + TypeScript
packages/
  db/                  # Prisma schema, migrations, seed
  contracts/           # DTOs, OpenAPI, tipos compartidos
  quote-engine/        # Motor de fórmulas puro y probado
  integrations/        # Adaptadores WeTravel, Wissify, XploreTogether
  ui/                  # Componentes compartidos
docs/                  # Este paquete de especificación
infra/                 # Docker, CI, despliegue
```

## Principios no negociables
- No afirmar que una integración funciona hasta validarla con documentación, credenciales y pruebas reales.
- No enviar una cotización sin aprobación registrada.
- No modificar versiones ya enviadas; crear una nueva versión.
- Los permisos se validan en el servidor, no solo en la interfaz.
- Todos los importes guardan moneda y precisión decimal; nunca usar `float` para dinero.
- No almacenar tokens ni secretos en el repositorio.
- Mantener auditabilidad, privacidad y exportación de datos.

## Desarrollo local
Requisitos: Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker.

```bash
cp .env.example .env          # ajusta POSTGRES_PASSWORD y DATABASE_URL
pnpm install
pnpm db:up                    # PostgreSQL 16 en infra/docker-compose.yml
pnpm --filter @ee/db migrate:deploy
pnpm build
pnpm --filter @ee/db seed     # crea la primera oficina y el SYSTEM_ADMIN (variables SEED_* en .env)
pnpm test                     # unitarias + integración (requiere DATABASE_URL)
pnpm --filter @ee/api dev     # API en http://localhost:4000/api/v1 (OpenAPI: /api/docs)
pnpm --filter @ee/web dev     # Web en http://localhost:3000
pnpm test:e2e                 # Playwright (antes: pnpm --filter @ee/web exec playwright install chromium)
```
