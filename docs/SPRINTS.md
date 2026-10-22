# Plan de implementación por sprints

Plan orientativo para un equipo pequeño; duración real depende de disponibilidad de desarrolladores, acceso a APIs y decisiones financieras.

## Sprint 0 — Descubrimiento y cimientos
- Confirmar fórmulas Excel con Finanzas.
- Revisar API/credenciales WeTravel y Wissify.
- Confirmar oficinas, dominios Google, roles y plantilla PDF.
- Monorepo, CI, lint, typecheck, tests, Docker y entornos.
**Salida:** decisiones registradas, arquitectura y pipeline inicial.

## Sprint 1 — Identidad, oficinas y permisos
- Login Google en staging.
- Usuarios, oficinas, roles y scopes.
- Auditoría base.
**Salida:** usuario autorizado solo ve recursos permitidos.

## Sprint 2 — Solicitudes
- Crear/editar/enviar solicitud, folio, validaciones.
- Bandeja, búsqueda, filtros, asignación.
- Timeline y comentarios.
**Salida:** flujo solicitud completo.

## Sprint 3 — Escenarios y motor de cotización
- Escenarios duplicables.
- Líneas, categorías, monedas y decimal math.
- Fórmulas iniciales y snapshot.
**Salida:** pruebas unitarias con datos de ejemplo.

## Sprint 4 — Aprobaciones y auditoría
- Revisión, aprobar/devolver.
- Bloqueo de autoaprobación.
- Invalidación por cambios y versionado.
**Salida:** imposible enviar una versión no aprobada.

## Sprint 5 — PDF y XLSX
- Plantillas, descarga privada, checksums.
- Diferenciar documento externo/interno.
**Salida:** documentos con permisos y pruebas de contenido.

## Sprint 6 — Envío y seguimiento
- Registrar envío, vigencia, destinatarios.
- Seguimiento, aceptar/rechazar/expirar.
- Exclusividad de propuesta ganadora.
**Salida:** trazabilidad comercial completa.

## Sprint 7 — Consolidado y reportes
- Comparador, indicadores y exportaciones.
**Salida:** panel usable con filtros por oficina y permisos.

## Sprint 8 — WeTravel
- Solo después de validar API y sandbox.
- Conector, mapping, retries, logs y pruebas.
**Salida:** integración verificada o fallback documentado.

## Sprint 9 — Wissify
- Confirmar producto/API, mapeo y permisos.
**Salida:** integración verificada o fallback documentado.

## Sprint 10 — XploreTogether contract
- API/evento de transferencia de propuesta aceptada.
- Contrato versionado y pruebas contractuales.
**Salida:** integración preparada, aunque el sistema destino aún no esté disponible.

## Sprint 11 — UAT, seguridad y lanzamiento
- Pruebas con usuarios de oficinas.
- Pruebas de seguridad, rendimiento básico, restauración.
- Manual de usuario y operación.
**Salida:** checklist de producción firmado.

## Gates de salida
No pasar a producción con fórmulas sin aprobación de Finanzas, fallas de autorización, secretos expuestos, documentos públicos, o integraciones no verificadas presentadas como funcionales.
