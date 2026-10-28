# Seguridad y privacidad

## Modelo de amenazas mínimo
- Usuario de otra oficina accede a solicitud por ID.
- Usuario altera precio/moneda o envía versión no aprobada.
- Robo de sesión/token o configuración OAuth incorrecta.
- Archivo malicioso o enlace de documento compartido públicamente.
- Webhook falso/repetido o fuga de secretos de integración.
- Exportación de márgenes por usuario no autorizado.
- Pérdida de datos o modificación no rastreable.

## Controles obligatorios
1. OIDC con Google; validar `issuer`, `audience`, `state`, `nonce`, expiración y redirect URI exacta.
2. Lista de dominios permitidos por agencia (Workspace, claim `hd`) más invitación explícita. Un dominio válido no equivale automáticamente a rol de administrador. Solo un administrador del sistema de EE da de alta agencias y sus dominios; el administrador de cada agencia solo invita correos de sus propios dominios. Un login desde el dominio propio de una agencia guarda ese origen en la cookie firmada del inicio de sesión, así que la redirección nunca depende del encabezado Host del callback.
3. RBAC + scope por agencia, oficina y recurso en cada endpoint. Aislamiento multi-agencia: la sesión carga la agencia del usuario y sus oficinas (`agencyOfficeIds`); `officeScope`/`officesWithRole` devuelven siempre una lista de oficinas de esa agencia (ya no existe «todas»), `hasOfficeRole` y demás reglas nunca aceptan una oficina ajena aunque el usuario sea administrador del sistema, y los catálogos/configuración de agencia se consultan con `agency_id` del usuario. Una agencia desactivada pierde el acceso en la siguiente petición. Pruebas: `apps/api/test/agency-isolation.test.ts`.
4. Cookies `HttpOnly`, `Secure`, `SameSite`; rotación/expiración de sesión y CSRF según arquitectura. Sesión de 12 h como máximo y cierre por inactividad tras `SESSION_IDLE_MINUTES` (120 por defecto) sin ninguna petición; la web lleva a login con el aviso "Tu sesión se cerró por inactividad".
5. HTTPS obligatorio; cifrado en reposo administrado por proveedor.
6. Secrets manager; `.env` ignorado por Git.
7. DTO con allowlist, límites de tamaño, normalización y validación de entrada.
8. ORM/consultas parametrizadas; CSP, escaping y protección XSS.
9. Rate limiting para login, exportaciones, endpoints públicos y webhooks.
10. Documentos privados; URL firmada de corta duración, autorización al generar y descargar.
11. Auditoría append-only para acciones críticas; no guardar secretos o datos sensibles en logs. La bitácora se consulta solo con rol coordinador, auditor o administrador del sistema, filtrada en servidor por sus oficinas.
12. Webhooks: verificar firma, timestamp, ventana de replay, idempotencia y tamaño del cuerpo.
13. Backups cifrados, retención definida y prueba periódica de restauración.
14. Dependabot/auditoría de dependencias, SAST y escaneo de secretos en CI.
15. Liga para el colegio (`/p/{token}`): token aleatorio de 256 bits mostrado una vez y guardado solo como hash; caducidad máxima 90 días, revocable; ruta pública con límite por IP y el mismo 404 para cualquier falla; solo sirve la propuesta sin costos de una versión autorizada de una solicitud abierta. Quien tenga la liga ve la propuesta: no compartirla en canales públicos.
16. Política de retención, borrado y acceso a datos personales aprobada por EE.

## Roles y separación de funciones
- El creador no aprueba su propia cotización.
- Solo usuarios con permiso `quote:send` envían propuestas, y solo tras comprobar aprobación vigente.
- Costes/márgenes internos no aparecen en PDF comercial.
- Exportaciones de información financiera quedan auditadas.
- Acceso de integración es mínimo y por sistema.
- Permisos por rol configurables (Sprint C) solo por el administrador del sistema y auditados (`role_policy.updated`). Ver/Crear/Editar/Borrar se evalúan en el servidor por oficina (`canDo`, `officeScope`) además de las reglas fijas del flujo; las oficinas por usuario solo las cambia el administrador del sistema (`user.offices_updated`). El tope de autorización se compara con el total del grupo en MXN; si la cotización no está en MXN y no tiene tipo de cambio a pesos, la autorización con tope se bloquea.
- Avisos por correo: solo folio, grupo y liga al cotizador; nunca precios, costos, márgenes ni comentarios de autorización. Se envían después de confirmar la acción y un fallo de SMTP no la revierte. Los logs registran solo el tipo de aviso y el código de error, sin direcciones. La contraseña de la cuenta va en Secret Manager.
- Correos al colegio (2026-10-28): salen de la cuenta del cotizador solo cuando el cotizador marca "Mandar el correo al colegio" al registrar el envío de una versión autorizada, o con "Enviar recordatorio de pago". La propuesta va como liga nueva de 30 días (mismo control que la liga para el colegio, revocable); nunca costos ni márgenes. El recordatorio lleva el monto por estudiante del plan de pagos (precio de venta, no costo). Destinatarios: hasta 10 correos validados; la bitácora guarda solo el conteo. Si el SMTP falla, el envío no se registra.
- Importador con IA: la hoja se procesa en memoria y no se guarda; solo se envía su texto a Vertex AI dentro del proyecto de Google Cloud de EE, con la cuenta de servicio (sin claves). La respuesta de la IA se valida como una edición manual y nunca se guarda sin revisión del cotizador. La bitácora solo registra conteos. Las ligas de Google Sheets se reconstruyen desde el ID (sin SSRF a otros hosts).

## Incidentes
Registrar, contener, revocar credenciales, preservar evidencia, evaluar alcance, notificar conforme a obligaciones legales y realizar análisis post-incidente. Definir contactos y tiempos antes de producción.

## Checklist antes de producción
- [ ] Revisión de seguridad independiente.
- [ ] Pruebas IDOR/BOLA y separación por agencia (`apps/api/test/agency-isolation.test.ts` cubre las rutas principales; falta extender `permissions-audit.test.ts` a dos agencias).
- [x] Pruebas IDOR/BOLA y separación por oficina (`apps/api/test/permissions-audit.test.ts`, 2026-10-28: 29 rutas por id y 12 listados/reportes, para los 5 roles de oficina, con control positivo).
- [ ] OAuth y sesión revisados.
- [ ] Pruebas de autorización de PDF/XLSX.
- [ ] Restauración de backup probada.
- [ ] Secretos y dependencias escaneados.
- [ ] Aviso de privacidad, retención y términos aprobados.
