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
2. Lista de dominios permitidos más control de acceso explícito. Un dominio válido no equivale automáticamente a rol de administrador.
3. RBAC + scope por oficina y recurso en cada endpoint.
4. Cookies `HttpOnly`, `Secure`, `SameSite`; rotación/expiración de sesión y CSRF según arquitectura.
5. HTTPS obligatorio; cifrado en reposo administrado por proveedor.
6. Secrets manager; `.env` ignorado por Git.
7. DTO con allowlist, límites de tamaño, normalización y validación de entrada.
8. ORM/consultas parametrizadas; CSP, escaping y protección XSS.
9. Rate limiting para login, exportaciones, endpoints públicos y webhooks.
10. Documentos privados; URL firmada de corta duración, autorización al generar y descargar.
11. Auditoría append-only para acciones críticas; no guardar secretos o datos sensibles en logs.
12. Webhooks: verificar firma, timestamp, ventana de replay, idempotencia y tamaño del cuerpo.
13. Backups cifrados, retención definida y prueba periódica de restauración.
14. Dependabot/auditoría de dependencias, SAST y escaneo de secretos en CI.
15. Política de retención, borrado y acceso a datos personales aprobada por EE.

## Roles y separación de funciones
- El creador no aprueba su propia cotización.
- Solo usuarios con permiso `quote:send` envían propuestas, y solo tras comprobar aprobación vigente.
- Costes/márgenes internos no aparecen en PDF comercial.
- Exportaciones de información financiera quedan auditadas.
- Acceso de integración es mínimo y por sistema.

## Incidentes
Registrar, contener, revocar credenciales, preservar evidencia, evaluar alcance, notificar conforme a obligaciones legales y realizar análisis post-incidente. Definir contactos y tiempos antes de producción.

## Checklist antes de producción
- [ ] Revisión de seguridad independiente.
- [ ] Pruebas IDOR/BOLA y separación por oficina.
- [ ] OAuth y sesión revisados.
- [ ] Pruebas de autorización de PDF/XLSX.
- [ ] Restauración de backup probada.
- [ ] Secretos y dependencias escaneados.
- [ ] Aviso de privacidad, retención y términos aprobados.
