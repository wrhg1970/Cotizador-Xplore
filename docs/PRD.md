# PRD funcional — Cotizador y Administrador de Propuestas EE
**Versión:** 1.0 | **Estado:** Base para validación | **Producto:** interno de EE, integrable con XploreTogether

## 1. Resumen
Aplicación web responsive para registrar solicitudes de viajes grupales, asignarlas a cotizadores, construir una o varias cotizaciones por solicitud, comparar escenarios, obtener aprobación obligatoria, generar PDF comercial y Excel interno, enviar/registrar propuestas y documentar el resultado comercial.

## 2. Problema
La información de solicitudes, versiones, costos y decisiones puede dispersarse entre hojas de cálculo, correo y conversaciones. EE necesita trazabilidad: quién solicitó, cuándo, especificaciones, quién cotizó, cuándo se envió, qué versión se aceptó y por qué.

## 3. Objetivos
- Capturar una solicitud en aproximadamente 3 minutos, sin duplicar datos.
- Mantener un folio único y un expediente por grupo.
- Generar escenarios por cantidad de participantes, chaperones y staff.
- Aplicar fórmulas configurables con trazabilidad de costes y moneda.
- Exigir aprobación antes de cualquier envío externo.
- Conservar versiones enviadas como instantáneas inmutables.
- Generar PDF para cliente y XLSX interno.
- Preparar integraciones con WeTravel y Wissify en MVP, sujetas a capacidades reales de sus API.
- Exponer contratos versionados para integración futura con XploreTogether.

## 4. No objetivos del MVP
- Reemplazar un CRM completo.
- Gestionar itinerarios diarios, pasaportes, expedientes migratorios o bienestar estudiantil.
- Procesar directamente pagos o almacenar datos completos de tarjetas.
- Automatizar integración cuando el proveedor no ofrezca API/permisos.
- Permitir que usuarios editen silenciosamente una propuesta ya enviada.

## 5. Personas y roles
- **Solicitante/Asesor:** crea y consulta solicitudes de su oficina; ve estado y documentos autorizados.
- **Cotizador:** asignado a solicitudes; crea escenarios, edita costes y prepara documentos.
- **Aprobador:** revisa, aprueba o devuelve cotizaciones. No puede aprobar su propia cotización por defecto.
- **Administrador de oficina:** asigna usuarios, consulta solicitudes de su oficina y gestiona parámetros permitidos.
- **Administrador del sistema:** gestiona oficinas, roles, catálogos, reglas globales e integraciones.
- **Auditor/Consulta:** lectura de reportes e historial según alcance autorizado.
- **Servicio de integración:** identidad técnica limitada a las operaciones necesarias.

## 6. Campos de solicitud
Obligatorios: nombre del grupo, oficina, fecha de salida, fecha de regreso, ciudad, país, número de participantes, moneda de presupuesto (si se especifica), solicitante.
Opcionales/configurables: chaperones, staff, presupuesto por persona o total (debe indicarse el tipo), comentarios/requerimientos, escuela/cliente, programa, destino adicional, fecha límite, prioridad, archivos adjuntos.
Automáticos: folio, creador, fechas de creación/actualización, estado, responsable, historial de eventos.
Validaciones: regreso >= salida; participantes >= 1; chaperones/staff >= 0; presupuesto no negativo; país/moneda de catálogos; límites razonables configurables.

## 7. Flujo y estados
### Solicitud
`DRAFT → SUBMITTED → ASSIGNED → QUOTING → QUOTE_REVIEW → QUOTE_APPROVED → SENT → FOLLOW_UP → ACCEPTED | REJECTED | EXPIRED | CANCELLED`
El estado `QUOTE_APPROVED` aplica a la versión aprobada, no necesariamente al expediente completo. Una solicitud puede tener varias cotizaciones/escenarios y versiones. El expediente puede volver a `QUOTING` si se requiere nueva versión.
- Enviar requiere una aprobación vigente para la versión exacta.
- Si se cambia cualquier dato comercial después de aprobar, la aprobación se invalida.
- Aceptar requiere identificar una versión enviada.
- La transición se valida en el backend mediante máquina de estados.
- Las transiciones administrativas excepcionales requieren motivo y auditoría.

## 8. Funcionalidades
### F-01 Identidad y acceso
- Inicio de sesión con Google Workspace.
- Lista de dominios de correo permitidos configurable.
- Aprovisionamiento controlado o por invitación; deshabilitar usuario revoca acceso.
- Roles y alcance por oficina.
- Sesión segura y cierre de sesión.

### F-02 Solicitudes
- Crear, editar borrador, enviar a cotización, asignar responsable y prioridad.
- Búsqueda por folio, grupo, oficina, destino, fecha y estado.
- Filtros y vistas guardadas simples.
- Comentarios y adjuntos con acceso privado.
- Timeline de actividad.

### F-03 Cotizador
- Una solicitud contiene múltiples escenarios; cada escenario tiene versiones.
- Duplicar escenario y cambiar participantes/chaperones/staff sin sobrescribir el original.
- Catálogo de conceptos con categoría, unidad, coste, moneda, regla de distribución y visibilidad.
- Fórmulas editables solo por rol autorizado, con versión, vigencia y pruebas.
- Separar coste, markup, comisión, precio de venta, impuestos y gastos compartidos.
- Calcular por participante, grupo y moneda.
- Mostrar advertencias de presupuesto, datos incompletos y margen negativo.
- Guardar copia de reglas y parámetros usados en cada versión.

### F-04 Aprobaciones
- Toda versión requiere aprobación antes de enviarse.
- Aprobador puede aprobar o devolver con comentarios.
- El creador/cotizador no aprueba su propia versión.
- Cualquier cambio material invalida aprobación.
- Registrar usuario, fecha, versión, decisión, comentarios y hash/identificador de snapshot.

### F-05 Documentos y envío
- PDF comercial con marca EE y resumen acordado, precio, vigencia, inclusiones/exclusiones y términos.
- XLSX interno con conceptos, cantidades, moneda, coste, precio, comisión, margen y fórmulas/valores calculados.
- PDF nunca expone costes internos por defecto.
- Versionado, almacenamiento privado y enlaces temporales.
- Registrar destinatarios, canal, fecha/hora, usuario, versión y resultado.
- En MVP puede registrarse envío manual; envío automatizado solo con proveedor de correo configurado.

### F-06 Consolidado
- Comparación de escenarios con número de participantes, chaperones, precio unitario, total, margen interno, vigencia y estado.
- Selección de propuesta ganadora vinculada a una versión enviada.
- Solo una ganadora por solicitud activa.
- Exportación consolidada a XLSX/PDF según permiso.

### F-07 Seguimiento y reportes
- Historial cronológico de cambios, asignación, aprobación, envío y resultado.
- Indicadores: tiempo de primera respuesta, tiempo de cotización, tasa de aprobación, conversión, cotización por oficina/destino/programa y margen agregado según permisos.
- Filtros por periodo, oficina, usuario, país, estado y programa.
- Exportaciones auditadas.

### F-08 Integraciones
- Capa de adaptadores separada del dominio.
- WeTravel y Wissify: validar primero disponibilidad de API, OAuth/API keys, webhooks, límites y términos. No usar scraping como sustituto.
- Integraciones deshabilitadas por defecto hasta configurar y probar credenciales.
- XploreTogether: contrato API versionado para transferir una propuesta aceptada; no acoplar la base de datos al sistema futuro.
- Sincronización idempotente, retries con backoff, dead-letter/errores visibles y registro de correlación.

## 9. Criterios de aceptación de producto
- Un asesor puede crear y enviar una solicitud válida sin asistencia técnica.
- El sistema asigna folio único y conserva quién/cuándo.
- El cotizador puede duplicar escenarios y cambiar cantidades sin alterar otros escenarios.
- Cada resultado se reproduce usando reglas, entradas, tipo de cambio y versión guardados.
- No se puede enviar una versión no aprobada ni una versión modificada tras aprobar.
- El PDF externo no contiene coste interno/margen.
- El XLSX interno está limitado a roles autorizados.
- Se puede ver quién envió qué versión y cuándo.
- No se permite aceptar dos versiones ganadoras en la misma solicitud.
- Acceso entre oficinas no autorizadas es rechazado en API.
- La falta de API de un proveedor no impide usar el cotizador manualmente.

## 10. Métricas
- Tiempo medio de registro de solicitud.
- Tiempo de solicitud a primera cotización.
- Tiempo de aprobación.
- Porcentaje de propuestas enviadas dentro de plazo.
- Conversión de propuestas enviadas a aceptadas.
- Diferencia entre presupuesto y precio final.
- Errores de cálculo detectados en pruebas/operación.
- Éxito y latencia de sincronizaciones por integración.

## 11. Supuestos y decisiones pendientes
- Monedas iniciales sugeridas: MXN, USD, EUR, GBP, CAD, AUD; catálogo ampliable.
- Tipo de cambio: manual en MVP con fuente y fecha; proveedor automático configurable después.
- Impuestos, IVA y reglas fiscales requieren validación contable/legal antes de producción.
- Confirmar fórmulas actuales de Excel: base de comisión, markup vs margen, distribución de gastos de chaperón, tratamiento de fondo de emergencia, redondeo y conversión.
- Confirmar marca/plantilla de PDF, vigencia estándar y términos comerciales.
- Confirmar dominios de Google permitidos, oficinas y responsables.
- Confirmar documentación/API y credenciales de WeTravel y Wissify.

## Alertas de vencimiento (2026-10-28)
Cuatro alertas con umbral en días configurable en Administración (0 = apagada): solicitud enviada sin cotización en autorización (al cotizador asignado o, sin asignar, a los administradores de la oficina), cotización en autorización (a los autorizadores de la oficina que no la armaron), propuesta enviada sin respuesta (ejecutivo y cotizador) y pagos de los alumnos por vencer según el plan de la versión ganada (ejecutivo y cotizador). Se ven en Mi trabajo y llegan en un correo diario sin precios.
