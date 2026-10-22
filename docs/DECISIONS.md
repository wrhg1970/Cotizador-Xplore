# Registro de decisiones y preguntas abiertas

## Decisiones confirmadas
- Usuarios: asesores y equipo cotizador.
- Toda cotización requiere aprobación antes de envío.
- Documentos: PDF comercial y XLSX interno.
- Integraciones WeTravel y Wissify desde la primera versión, si API y permisos lo permiten.
- XploreTogether se integra después mediante contrato API/evento versionado.
- Login con credenciales corporativas Google.
- Arquitectura independiente e integrable.

## No asumir sin confirmación
1. Fórmula de comisión y su base.
2. Markup o margen objetivo.
3. Distribución de gastos de chaperones.
4. Tratamiento de fondo de emergencia, seguros, kits, promociones e impuestos.
5. Fuentes de tipo de cambio y política de redondeo.
6. Dominio(s) Google permitidos y matriz de roles por oficina.
7. Proveedor de correo y si el envío será automático en MVP.
8. Proveedor de almacenamiento de documentos.
9. APIs exactas y permisos disponibles de WeTravel y Wissify.
10. Campos y evento de destino de XploreTogether.
11. Plantilla de PDF, vigencia, términos comerciales y datos de contacto.
12. Retención de datos y requisitos legales aplicables.

## Riesgos principales
- Diferencias entre Excel actual y fórmula programada.
- APIs externas insuficientes o sin acceso aprobado.
- Exposición de costes internos en documento cliente.
- Aprobación accidental de versión distinta a la enviada.
- Ambigüedad entre presupuesto total y presupuesto por estudiante.

## Decisiones técnicas de Sprint 0 (2026-10-22)
- Lanzamiento como piloto de alcance mínimo; integraciones WeTravel/Wissify fuera del piloto (ID externo manual).
- Monorepo pnpm workspaces + Turborepo; Node 22; TypeScript 5.9 `strict` (TS 7 pospuesto hasta validar compatibilidad con decoradores de NestJS).
- NestJS 12 (ESM) con Vitest + SWC como único runner de pruebas.
- Zod en `packages/contracts` como fuente única de validación.
- Prisma 7.10 (estable) con `@prisma/adapter-pg`; la etiqueta `latest` de npm apunta a una RC de Prisma 8 y no se usa.
- Dinero con `decimal.js` en el motor y strings decimales en JSON.
- `audit_logs` append-only reforzado con trigger en PostgreSQL.
- Pendiente: alojamiento, almacenamiento de documentos, librería PDF, dominios Google, fórmulas de Finanzas.
