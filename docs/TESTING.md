# Plan de pruebas

## Pirámide
1. Unitarias: motor de cotización, reglas de estado, permisos, validadores.
2. Integración: PostgreSQL/Prisma, transacciones, restricciones y generación de documentos.
3. API: contratos, errores, autenticación/autorización, idempotencia.
4. E2E: flujos de asesor a cotizador, aprobación, envío y resultado.
5. Seguridad: IDOR/BOLA, XSS, CSRF, carga de archivos, OAuth, secretos, webhooks.
6. Aceptación de usuario: asesores y cotizadores de al menos dos oficinas.

## Casos críticos
- No se puede enviar sin aprobación.
- No se puede autoaprobar.
- Editar una cotización aprobada invalida aprobación o exige nueva versión.
- Dos usuarios intentan aceptar versiones distintas simultáneamente: solo una gana.
- Usuario de oficina A no ve solicitud de oficina B sin permiso explícito.
- El PDF no expone coste/margen interno.
- El XLSX interno no se descarga sin permiso.
- Conversión FX registra tasa/fuente/fecha.
- Cálculo reproduce resultado a partir de snapshot.
- Fallo de WeTravel/Wissify no pierde solicitud ni cotización.
- Webhook repetido no duplica acciones.
- Envío reintentado no duplica registro ni correo si proveedor soporta idempotencia.
- Restauración de backup documentada y verificada.

## Regresión de Excel
Antes de producción, Finanzas debe proporcionar casos representativos aprobados, incluidos casos de 1/10/20/50 participantes, distintos chaperones, días, monedas, descuentos, comisiones, fondos y redondeos. Comparar el motor con resultados aprobados y documentar cualquier diferencia.

## Definition of Done
Criterios de aceptación satisfechos, tests automáticos ejecutados, migraciones verificadas, revisión de permisos, documentación actualizada y sin defectos críticos abiertos.
