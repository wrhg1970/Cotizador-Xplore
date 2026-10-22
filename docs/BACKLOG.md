# Backlog inicial — historias de usuario y criterios de aceptación

Prioridad: P0 = imprescindible para MVP; P1 = importante; P2 = mejora posterior.
Formato: ID | Historia | Prioridad | Criterios de aceptación

## Identidad y permisos
- US-001 | Como usuario EE quiero iniciar sesión con Google para evitar otra contraseña. | P0 | OAuth/OIDC validado; solo dominios/usuarios autorizados; sesión segura.
- US-002 | Como administrador quiero invitar/desactivar usuarios. | P0 | Usuario desactivado pierde acceso en siguiente validación de sesión.
- US-003 | Como administrador quiero asignar roles. | P0 | Roles se aplican en servidor y quedan auditados.
- US-004 | Como usuario de oficina quiero ver solo solicitudes autorizadas. | P0 | Acceso cruzado devuelve 403/404 sin filtrar datos.
- US-005 | Como auditor quiero consultar eventos sensibles. | P1 | Timeline con actor, acción, fecha y entidad; sin secretos.
- US-006 | Como administrador quiero configurar alcance multi-oficina. | P0 | Acceso global solo con permiso explícito.
- US-007 | Como usuario quiero cerrar sesión. | P0 | Sesión invalidada y cookies limpiadas.
- US-008 | Como administrador quiero revisar accesos recientes. | P2 | Reporte limitado a usuarios autorizados.

## Solicitudes
- US-009 | Como asesor quiero crear una solicitud. | P0 | Campos requeridos validados y folio único.
- US-010 | Como asesor quiero guardar borrador. | P0 | Borrador persiste y solo autor/roles autorizados lo editan.
- US-011 | Como asesor quiero enviar a cotización. | P0 | Cambia estado y crea evento auditado.
- US-012 | Como asesor quiero capturar grupo, oficina y destino. | P0 | Datos quedan asociados a folio.
- US-013 | Como asesor quiero registrar salida y regreso. | P0 | Regreso no puede ser anterior a salida.
- US-014 | Como asesor quiero registrar participantes, chaperones y staff. | P0 | Participantes >=1; otros >=0.
- US-015 | Como asesor quiero registrar presupuesto con base y moneda. | P0 | Se distingue total vs por participante.
- US-016 | Como asesor quiero agregar requerimientos. | P0 | Texto limitado y sanitizado.
- US-017 | Como asesor quiero adjuntar archivos. | P1 | Tamaño/MIME validados, almacenamiento privado.
- US-018 | Como asesor quiero buscar por folio. | P0 | Resultados dentro de su alcance.
- US-019 | Como asesor quiero filtrar solicitudes. | P1 | Filtros combinables y paginación.
- US-020 | Como coordinador quiero asignar cotizador. | P0 | Solo roles autorizados; cambio auditado.
- US-021 | Como cotizador quiero ver mi bandeja. | P0 | Incluye asignadas y pendientes según permisos.
- US-022 | Como usuario quiero ver el timeline. | P0 | Eventos ordenados y con fecha/hora.
- US-023 | Como usuario quiero comentar. | P1 | Autor y fecha registrados; permisos aplicados.
- US-024 | Como administrador quiero cancelar solicitud. | P1 | Motivo obligatorio y evento de auditoría.
- US-025 | Como asesor quiero ver el estado actual. | P0 | Estado y responsable visibles.
- US-026 | Como coordinador quiero marcar prioridad/fecha límite. | P1 | Alertas y orden de bandeja.
- US-027 | Como usuario quiero editar solicitud antes de cotizar. | P0 | Cambios validados; cambios materiales posteriores registrados.
- US-028 | Como auditor quiero exportar listado autorizado. | P2 | Exportación limitada por permisos y auditada.

## Escenarios y líneas
- US-029 | Como cotizador quiero crear escenarios múltiples. | P0 | Cada escenario tiene ID y pertenece a solicitud.
- US-030 | Como cotizador quiero duplicar escenario. | P0 | Copia líneas/entradas; nuevo ID; no altera original.
- US-031 | Como cotizador quiero cambiar participantes por escenario. | P0 | Recalcula sin afectar escenarios hermanos.
- US-032 | Como cotizador quiero cambiar chaperones/staff. | P0 | Recalcula asignaciones explícitas.
- US-033 | Como cotizador quiero agregar concepto. | P0 | Categoría, cantidad, unidad, coste, moneda y reparto requeridos.
- US-034 | Como cotizador quiero editar conceptos en borrador. | P0 | Solo versión editable.
- US-035 | Como cotizador quiero marcar conceptos internos. | P0 | Nunca aparecen en PDF comercial por defecto.
- US-036 | Como cotizador quiero usar catálogo de conceptos. | P1 | Catálogo versionado y permiso requerido para editarlo.
- US-037 | Como cotizador quiero añadir costes fijos. | P0 | Reparto se define explícitamente.
- US-038 | Como cotizador quiero añadir coste por día/persona. | P0 | Total depende de días/personas correctos.
- US-039 | Como cotizador quiero registrar gastos de chaperones. | P0 | Se muestran separados y con regla de absorción.
- US-040 | Como cotizador quiero registrar fondo de emergencia. | P1 | Base fija/por persona/por día configurable.
- US-041 | Como cotizador quiero registrar descuentos. | P1 | Base y porcentaje visibles en auditoría.
- US-042 | Como cotizador quiero registrar comisión. | P0 | Base de comisión explícita y versionada.
- US-043 | Como cotizador quiero registrar promoción. | P1 | Impacto en coste/precio explícito.
- US-044 | Como cotizador quiero añadir comentarios internos. | P1 | No aparecen en PDF externo.
- US-045 | Como cotizador quiero ver advertencias de datos incompletos. | P0 | No permite someter a aprobación si faltan inputs críticos.
- US-046 | Como cotizador quiero guardar borrador. | P0 | Persiste y calcula versión de borrador.
- US-047 | Como cotizador quiero comparar escenarios. | P0 | Muestra cantidades, precio y estado en una vista.
- US-048 | Como cotizador quiero clonar una cotización anterior como base. | P1 | Crea nuevo escenario/versionado sin compartir estado de aprobación.
- US-049 | Como cotizador quiero comparar versiones. | P1 | Diferencias de líneas y resultados visibles.
- US-050 | Como cotizador quiero registrar supuestos. | P0 | Snapshot incluye supuestos.
- US-051 | Como cotizador quiero indicar vigencia. | P0 | Vigencia obligatoria antes de aprobación.
- US-052 | Como cotizador quiero ver coste y precio por persona. | P0 | Diferencia coste/venta claramente rotulada.
- US-053 | Como cotizador quiero ver total del grupo. | P0 | Total concuerda con líneas y política de reparto.
- US-054 | Como administrador quiero habilitar monedas. | P1 | Solo monedas activas seleccionables.
- US-055 | Como cotizador quiero registrar tipo de cambio. | P0 | Tasa, fecha, fuente y usuario/proceso guardados.
- US-056 | Como cotizador quiero elegir política de redondeo. | P1 | Política versionada por moneda/regla.
- US-057 | Como sistema quiero usar decimales exactos. | P0 | No se usa float para importes; pruebas de precisión.
- US-058 | Como cotizador quiero recalcular. | P0 | Resultado determinista y hash generado.
- US-059 | Como auditor quiero reproducir cálculo. | P1 | Inputs y reglas guardados producen mismo resultado.
- US-060 | Como administrador quiero versionar fórmulas. | P0 | Nueva versión no cambia propuestas históricas.
- US-061 | Como administrador quiero activar fórmula por fecha. | P1 | Vigencia controlada y auditable.
- US-062 | Como sistema quiero bloquear división entre cero. | P0 | Error validado, sin cálculo inválido.
- US-063 | Como sistema quiero alertar margen negativo. | P0 | Advertencia visible y motivo requerido para excepción.
- US-064 | Como sistema quiero alertar presupuesto excedido. | P1 | Comparación con base presupuestal correcta.
- US-065 | Como cotizador quiero separar coste de chaperones. | P0 | Configuración define si se cobra aparte o distribuye.
- US-066 | Como cotizador quiero ver desglose por moneda original. | P1 | Moneda original y conversión aparecen internamente.
- US-067 | Como administrador quiero impedir fórmulas arbitrarias. | P0 | Solo AST/operadores/variables permitidos.
- US-068 | Como finanzas quiero probar fórmulas contra casos de Excel. | P0 | Suite de regresión aprobada antes de producción.

## Aprobación
- US-069 | Como cotizador quiero enviar versión a revisión. | P0 | Estado cambia y snapshot queda congelado para revisión.
- US-070 | Como aprobador quiero revisar costes/margen. | P0 | Solo con permiso financiero.
- US-071 | Como aprobador quiero aprobar. | P0 | Guarda actor, fecha, comentario, hash exacto.
- US-072 | Como aprobador quiero devolver con comentarios. | P0 | Cotizador ve motivo y puede crear versión revisada.
- US-073 | Como sistema quiero prohibir autoaprobación. | P0 | El creador no puede aprobar su propia versión.
- US-074 | Como sistema quiero exigir aprobación antes de envío. | P0 | Endpoint de envío rechaza sin aprobación vigente.
- US-075 | Como sistema quiero invalidar aprobación si cambia el cálculo. | P0 | Hash no coincide y envío bloqueado.
- US-076 | Como auditor quiero ver quién aprobó. | P0 | Registro inmutable asociado a versión.
- US-077 | Como administrador quiero una excepción controlada. | P2 | Solo permiso especial, motivo obligatorio y auditoría.
- US-078 | Como aprobador quiero comparar cambios respecto a versión previa. | P1 | Diferencias de coste/precio/condiciones visibles.
- US-079 | Como sistema quiero bloquear cambios tras enviar. | P0 | Se crea nueva versión para cualquier cambio.
- US-080 | Como aprobador quiero ver alertas antes de decidir. | P0 | Errores y warnings están claros.

## Documentos y envío
- US-081 | Como cotizador quiero generar PDF comercial. | P0 | PDF legible con precio, vigencia y condiciones; sin coste interno.
- US-082 | Como cotizador quiero generar XLSX interno. | P0 | Desglose financiero completo para rol autorizado.
- US-083 | Como usuario autorizado quiero descargar documentos. | P0 | Permiso y alcance validados en servidor.
- US-084 | Como cotizador quiero previsualizar PDF. | P1 | Vista previa coincide con archivo final.
- US-085 | Como cotizador quiero registrar destinatarios. | P0 | Formato validado y destinatarios auditados.
- US-086 | Como cotizador quiero registrar envío manual. | P0 | Versión, fecha, canal, usuario y destinatarios registrados.
- US-087 | Como usuario quiero enviar por correo desde app. | P1 | Solo si proveedor de correo está configurado; resultado auditado.
- US-088 | Como sistema quiero usar URL firmada temporal. | P0 | Documento no público y enlace expira.
- US-089 | Como sistema quiero generar checksum. | P1 | Integridad verificable.
- US-090 | Como administrador quiero editar plantilla PDF. | P2 | Solo rol autorizado; versiones preservadas.
- US-091 | Como usuario quiero descargar Excel consolidado. | P1 | Contenido limitado a permisos.
- US-092 | Como sistema quiero impedir fugas en PDF. | P0 | Test busca campos de costes/márgenes internos.
- US-093 | Como sistema quiero controlar versión del documento. | P0 | Cada documento identifica quote version exacta.
- US-094 | Como cotizador quiero registrar vigencia en envío. | P0 | Envío no puede quedar sin fecha de expiración definida.

## Consolidado y resultados
- US-095 | Como asesor quiero comparar propuestas. | P0 | Escenarios visibles lado a lado.
- US-096 | Como gerente quiero ver margen interno. | P0 | Solo rol autorizado lo ve.
- US-097 | Como usuario quiero aceptar una propuesta. | P0 | Se refiere a versión enviada y guarda actor/fecha/evidencia.
- US-098 | Como usuario quiero rechazar propuesta. | P0 | Motivo requerido configurable.
- US-099 | Como sistema quiero permitir una sola ganadora. | P0 | Restricción transaccional impide dos ganadoras.
- US-100 | Como usuario quiero marcar propuesta expirada. | P1 | Expiración según vigencia o acción autorizada.
- US-101 | Como sistema quiero generar evento para XploreTogether. | P1 | Evento outbox al aceptar, con payload mínimo.
- US-102 | Como usuario quiero reabrir solicitud. | P2 | Permiso y motivo requeridos; historial intacto.
- US-103 | Como gerente quiero ver tasa de conversión. | P1 | Definición y denominador documentados.
- US-104 | Como gerente quiero filtrar reportes por oficina. | P1 | Solo oficinas autorizadas.
- US-105 | Como gerente quiero ver tiempos de ciclo. | P1 | Basado en timestamps auditados.
- US-106 | Como usuario quiero exportar el consolidado. | P1 | PDF/XLSX según permisos.
- US-107 | Como auditor quiero ver el motivo de pérdida. | P1 | Motivo almacenado y reportable.

## Integraciones
- US-108 | Como administrador quiero configurar conexión WeTravel. | P0 | Secreto guardado fuera de DB/logs; estado visible.
- US-109 | Como administrador quiero probar conexión WeTravel. | P0 | Resultado sin revelar secretos.
- US-110 | Como sistema quiero sincronizar entidad compatible con WeTravel. | P1 | Solo operaciones verificadas en API oficial/sandbox.
- US-111 | Como sistema quiero reintentar fallos WeTravel. | P1 | Backoff, límite de intentos y deduplicación.
- US-112 | Como administrador quiero ver jobs WeTravel. | P1 | Estado, timestamps y error redactado.
- US-113 | Como administrador quiero configurar Wissify. | P0 | Proveedor/URL/API confirmados antes de activar.
- US-114 | Como sistema quiero probar conexión Wissify. | P0 | Prueba documentada, error accionable.
- US-115 | Como sistema quiero sincronizar entidad compatible con Wissify. | P1 | Mapping validado y permisos de datos confirmados.
- US-116 | Como sistema quiero procesar webhooks de forma segura. | P1 | Firma, timestamp, replay e idempotencia.
- US-117 | Como administrador quiero pausar integración. | P1 | No se lanzan jobs nuevos; jobs activos finalizan o se cancelan de forma segura.
- US-118 | Como sistema quiero mapear ID externo. | P1 | Unique key por proveedor/entidad.
- US-119 | Como administrador quiero revisar errores. | P1 | Error redactado, correlation ID y reintento autorizado.
- US-120 | Como arquitecto quiero contrato XploreTogether. | P1 | OpenAPI/event schema versionado y contract tests.
- US-121 | Como sistema quiero transferir propuesta aceptada a XploreTogether. | P2 | Solo con destino/API disponibles; idempotente y auditado.
- US-122 | Como sistema quiero operar sin API externa. | P0 | Funcionalidad local completa y export/import de fallback.
- US-123 | Como seguridad quiero limitar scopes de integración. | P0 | Credenciales con privilegios mínimos.
- US-124 | Como sistema quiero redaccionar logs de integración. | P0 | No hay tokens ni datos personales innecesarios.

## Administración, calidad y operación
- US-125 | Como administrador quiero administrar conceptos. | P1 | Cambios versionados y auditados.
- US-126 | Como administrador quiero administrar oficinas. | P0 | Alta/baja sin borrar historia.
- US-127 | Como administrador quiero administrar catálogos. | P1 | Solo roles autorizados.
- US-128 | Como sistema quiero health checks. | P1 | No exponen secretos ni detalles internos.
- US-129 | Como DevOps quiero migraciones reproducibles. | P0 | Pipeline y rollback/forward plan documentados.
- US-130 | Como DevOps quiero backups. | P0 | Política y prueba de restauración documentadas.
- US-131 | Como desarrollador quiero tests unitarios. | P0 | CI ejecuta tests de motor y dominio.
- US-132 | Como desarrollador quiero tests E2E. | P0 | Flujos críticos corren en staging/CI.
- US-133 | Como seguridad quiero escaneo de dependencias. | P0 | CI falla ante vulnerabilidades críticas según política.
- US-134 | Como usuario quiero interfaz accesible. | P1 | Navegación teclado, etiquetas y contraste revisados.
- US-135 | Como usuario quiero errores claros. | P0 | Mensajes útiles sin stack traces.
- US-136 | Como soporte quiero correlation ID. | P1 | Error visible y localizable en logs.
- US-137 | Como admin quiero configurar vigencias por defecto. | P1 | Versionado/auditoría.
- US-138 | Como admin quiero gestionar zonas horarias. | P2 | Guardar UTC y mostrar zona configurada.
- US-139 | Como gerente quiero métricas de uso. | P2 | Agregadas, con acceso controlado.
- US-140 | Como admin quiero exportar auditoría. | P2 | Alcance y permisos verificados.
- US-141 | Como usuario quiero ayuda contextual. | P2 | Instrucciones breves por pantalla.
- US-142 | Como sistema quiero evitar pérdida por concurrencia. | P0 | Control de versión/ETag.
- US-143 | Como sistema quiero limitar adjuntos. | P0 | Tipo/tamaño/escaneo y almacenamiento privado.
- US-144 | Como admin quiero política de retención. | P1 | Retención configurable y compatible con requisitos legales.
- US-145 | Como equipo quiero entorno staging. | P0 | Datos separados y sin credenciales productivas.
- US-146 | Como equipo quiero despliegue reproducible. | P0 | Pipeline versionado y health check.
- US-147 | Como usuario quiero exportar una solicitud autorizada. | P2 | Se exporta solo información permitida.
- US-148 | Como auditor quiero verificar integridad de documentos. | P2 | Checksum y versión disponibles.
- US-149 | Como negocio quiero medir tiempo de cotización. | P1 | Fechas automáticas y definición uniforme.
- US-150 | Como equipo quiero manual de operación. | P1 | Procedimientos para usuarios y administradores.

## Historias de expansión (P2)
- US-151 | Como asesor quiero plantillas por tipo de programa. | P2 | Plantilla rellena campos iniciales sin sobreescribir datos.
- US-152 | Como cotizador quiero importar líneas desde XLSX aprobado. | P2 | Plantilla validada, preview y reporte de errores.
- US-153 | Como usuario quiero clonar una solicitud histórica. | P2 | Nuevo folio, fechas y destinatarios no se copian automáticamente.
- US-154 | Como gerente quiero comparar precio estimado vs real. | P2 | Solo si existen datos reales de coste y reglas definidas.
- US-155 | Como admin quiero umbrales de aprobación por oficina. | P2 | Política versionada; nunca elimina aprobación obligatoria.
- US-156 | Como aprobador quiero delegar temporalmente. | P2 | Delegación con fechas, alcance y auditoría.
- US-157 | Como usuario quiero comentarios @mención. | P2 | Notificación solo a usuarios autorizados.
- US-158 | Como sistema quiero recordatorios de seguimiento. | P2 | Configuración y zona horaria respetadas.
- US-159 | Como usuario quiero cargar logo/branding de oficina. | P2 | Assets validados y versiones históricas preservadas.
- US-160 | Como administrador quiero múltiples plantillas de PDF. | P2 | Plantilla seleccionada por programa/mercado.
- US-161 | Como finanzas quiero reporte de comisiones. | P2 | Base de cálculo visible y auditada.
- US-162 | Como usuario quiero guardar vistas. | P2 | Preferencia por usuario y sin ampliar permisos.
- US-163 | Como gerente quiero exportar KPI a CSV. | P2 | Filtros y permisos aplicados.
- US-164 | Como admin quiero gestionar proveedores externos. | P2 | Datos de conexión cifrados/secret manager.
- US-165 | Como sistema quiero reconciliar IDs externos. | P2 | Duplicados detectados y resolución auditada.
- US-166 | Como usuario quiero avisos de propuesta por vencer. | P2 | Alertas no duplicadas y auditables.
- US-167 | Como admin quiero pausar envío externo. | P1 | Interruptor global y auditoría.
- US-168 | Como sistema quiero verificar documentos antes de envío. | P0 | Deben existir PDF aprobado y vigencia válida.
- US-169 | Como aprobador quiero rechazar por política. | P0 | Comentario y estado guardados.
- US-170 | Como sistema quiero proteger versiones aprobadas. | P0 | Snapshot y hash coinciden en envío.
- US-171 | Como usuario quiero indicar idioma de propuesta. | P2 | Plantillas traducidas y selección auditada.
- US-172 | Como usuario quiero especificar presupuesto total. | P0 | La base del presupuesto queda explícita.
- US-173 | Como usuario quiero especificar presupuesto por participante. | P0 | Se compara con precio unitario correcto.
- US-174 | Como cotizador quiero ver gastos fijos y variables. | P0 | Categorías y reparto se muestran.
- US-175 | Como sistema quiero impedir editar línea tras envío. | P0 | API rechaza mutación.
- US-176 | Como admin quiero aprobar cambios de fórmula. | P1 | Publicación de regla exige revisión.
- US-177 | Como sistema quiero validar tipo de cambio. | P0 | Tasa > 0 y par de monedas consistente.
- US-178 | Como cotizador quiero registrar fuente de coste. | P1 | Fuente/proveedor y fecha guardados.
- US-179 | Como gerente quiero ver cotizaciones por destino. | P1 | Filtros respetan oficina.
- US-180 | Como gerente quiero ver propuestas perdidas. | P1 | Motivos normalizados y texto opcional.
- US-181 | Como usuario quiero recuperar borrador tras error de red. | P1 | Guardado confirmado; indicador de estado.
- US-182 | Como sistema quiero limitar intentos de login. | P0 | Rate limit y alertas configuradas.
- US-183 | Como admin quiero revisar conexiones externas. | P1 | Estado, última prueba y permisos.
- US-184 | Como sistema quiero deduplicar webhooks. | P0 | Evento repetido no repite acción.
- US-185 | Como sistema quiero proteger endpoints de exportación. | P0 | Rate limit, autorización y auditoría.
- US-186 | Como sistema quiero bloquear URL de documento caducada. | P0 | Descarga posterior a expiración falla.
- US-187 | Como admin quiero verificar salud de worker. | P1 | Jobs atascados visibles.
- US-188 | Como sistema quiero reintentar job con límite. | P1 | No hay loop infinito.
- US-189 | Como equipo quiero pruebas contractuales de proveedores. | P1 | Sandbox/fixtures y versión de API documentados.
- US-190 | Como sistema quiero una salida de integración legible. | P1 | Estado y causa sin secretos.
- US-191 | Como auditor quiero revisar quién cambió precio. | P0 | Antes/después redactado y actor/fecha.
- US-192 | Como sistema quiero detectar cambio material. | P0 | Cambios en líneas, precio, moneda, FX o términos invalidan aprobación.
- US-193 | Como admin quiero editar reglas de distribución. | P1 | Nueva versión no afecta cotizaciones congeladas.
- US-194 | Como usuario quiero duplicar un PDF como borrador. | P2 | Se genera nueva versión claramente marcada.
- US-195 | Como cotizador quiero marcar propuesta como alternativa. | P1 | Comparador distingue escenarios.
- US-196 | Como sistema quiero generar folio legible. | P0 | Único, no secuencialmente predecible como autorización.
- US-197 | Como usuario quiero cambiar responsable. | P1 | Permiso y auditoría.
- US-198 | Como gerente quiero ver solicitudes sin movimiento. | P1 | Umbral configurable.
- US-199 | Como sistema quiero anonimizar logs. | P0 | No se guardan secretos ni payloads sensibles.
- US-200 | Como administrador quiero exportar configuración de fórmulas. | P2 | Solo rol autorizado, versión e integridad.

## Criterios transversales para todas las historias
- Autorización de servidor y validación de entrada.
- Auditoría para acciones críticas.
- Estados de error legibles y correlation ID.
- Pruebas unitarias/integración según riesgo.
- Documentación actualizada.
- No exponer información de otra oficina ni costes internos a usuarios no autorizados.
