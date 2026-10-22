# Instrucciones permanentes para Claude Code

## Misión
Construir una aplicación web segura y sencilla para Estudiantes Embajadores (EE): solicitudes de viajes grupales, cotizaciones multiescenario, aprobación obligatoria, propuestas PDF/Excel, seguimiento y conectores para WeTravel/Wissify; integración futura con XploreTogether.

## Antes de cambiar código
1. Lee `README.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DATABASE.md`, `docs/API_SPEC.md`, `docs/FORMULAS.md`, `docs/INTEGRATIONS.md`, `docs/UX_SPEC.md`, `docs/TESTING.md`, `docs/BACKLOG.md` y `docs/SPRINTS.md`.
2. Inspecciona el estado real del repositorio y no sobrescribas trabajo existente.
3. Resume el objetivo, los archivos que cambiarás, los riesgos y las pruebas que ejecutarás.
4. Implementa una historia a la vez, salvo que el usuario autorice explícitamente otro alcance.

## Stack previsto
- Monorepo TypeScript.
- Web: Next.js, React, TypeScript.
- API: NestJS, TypeScript, REST/OpenAPI.
- Datos: PostgreSQL + Prisma.
- Identidad: Google OpenID Connect/OAuth 2.0 mediante librería mantenida.
- Validación: Zod en cliente/paquetes y DTO/validación estricta en API.
- Pruebas: Vitest/Jest, Playwright, pruebas de integración de base de datos.
- Documentos: PDF y XLSX generados en servidor.
- Entorno local: Docker Compose.

No cambies el stack sin explicar beneficio, coste y migración.

## Reglas de negocio críticas
- Toda cotización requiere aprobación explícita antes de enviarse.
- El solicitante no puede aprobar su propia cotización, salvo que se defina una excepción formal en política; por defecto, prohibido.
- Una propuesta enviada es una instantánea inmutable. Los cambios crean una versión nueva y requieren nueva aprobación.
- Solo puede existir una propuesta ganadora por solicitud activa, salvo una decisión administrativa auditada.
- Estados válidos y transiciones: ver `docs/PRD.md`.
- El motor de cotización debe ser determinista, versionado y sin efectos secundarios.
- Cada regla de fórmula debe tener pruebas unitarias y ejemplos aprobados.
- Los cálculos monetarios usan decimal exacto, redondeo configurable y moneda explícita.
- Nunca inferir tipos de cambio sin guardar valor, fecha, proveedor/fuente y usuario o proceso que lo capturó.
- Nunca incluir costes internos, márgenes o comisiones en el PDF del cliente, salvo configuración explícita y autorizada.
- Todo cambio de estado, aprobación, envío, aceptación, rechazo, precio o fórmula genera auditoría.

## Seguridad
- Autorización en servidor para cada recurso y cada acción.
- Verificar organización/oficina y pertenencia a recursos para evitar IDOR/BOLA.
- Validar firma/estado de OAuth, `state`, `nonce`, redirect URI y dominio permitido.
- Secretos solo en variables de entorno/gestor de secretos.
- Webhooks con firma, timestamp, protección contra replay e idempotencia cuando el proveedor lo permita.
- No registrar tokens, contraseñas, documentos sensibles ni payloads completos con datos personales.
- Usar consultas parametrizadas/ORM, límites de carga, validación MIME y protección CSRF/XSS.
- Aplicar rate limits y controles de sesión.
- Los tests de seguridad son parte de Definition of Done.

## Calidad y forma de trabajar
- TypeScript `strict: true`; evitar `any`. Si es inevitable, documentar por qué.
- Funciones pequeñas, nombres explícitos, errores tipados y logs estructurados.
- No introducir datos de producción en fixtures.
- Migraciones aditivas siempre que sea posible; no borrar ni alterar datos sin plan.
- No instalar dependencias sin justificar y verificar mantenimiento/licencia.
- No afirmar que pruebas pasaron si no se ejecutaron.
- Mantener OpenAPI, tests y documentación alineados.
- Cada PR/entrega debe incluir: resumen, decisiones, migraciones, pruebas ejecutadas, riesgos pendientes y pasos manuales.

## Definition of Done
Una historia está terminada solo cuando:
1. Cumple criterios de aceptación.
2. Tiene validación y autorización en servidor.
3. Tiene pruebas pertinentes, incluyendo casos negativos.
4. Actualiza documentación/API si aplica.
5. Incluye auditoría para acciones sensibles.
6. No introduce secretos, vulnerabilidades conocidas ni cambios no solicitados.
7. El usuario puede probarla con instrucciones claras.
