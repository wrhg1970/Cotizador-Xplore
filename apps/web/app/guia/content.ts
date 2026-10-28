import type { RoleName } from '@ee/contracts';

export interface RoleGuide {
  role: RoleName;
  title: string;
  summary: string;
  steps: string[];
}

/** Short how-to per role; the welcome tour shows the guides of the roles the person holds. */
export const GUIDES: RoleGuide[] = [
  {
    role: 'ADVISOR',
    title: 'Vendedor / asesor',
    summary: 'Captura lo que pide el colegio y da seguimiento hasta que gane o pierda.',
    steps: [
      'En Solicitudes → Nueva solicitud captura grupo, destino, fechas, alumnos y chaperones (o impórtala desde un Excel o una liga de Google Sheets).',
      'Adjunta los archivos que mandó el colegio y pulsa "Enviar a cotización".',
      'En Mi trabajo ves en qué etapa va cada solicitud: Solicitada, Cotizada, Aprobada y Enviada.',
      'Cuando la propuesta esté autorizada, compártela con la liga para el colegio o regístrala como enviada.',
      'Al final marca la solicitud como Ganada (con la propuesta que aceptó el colegio) o Perdida, con el motivo.',
    ],
  },
  {
    role: 'QUOTER',
    title: 'Cotizador',
    summary: 'Arma los escenarios con la hoja EE y los manda a autorizar.',
    steps: [
      'En Inicio, el filtro "Mi turno hoy" muestra las solicitudes donde te toca actuar.',
      'Crea un escenario: primero los tipos de cambio (botón "Usar tipos de cambio oficiales"), luego los rubros por bloque; la barra de abajo muestra los totales en vivo.',
      'Usa plantillas y proveedores para no capturar dos veces; duplica un escenario para comparar opciones.',
      'Cuando esté lista, pulsa "Enviar a autorización". No puedes autorizar tu propia cotización.',
      'Si te la devuelven, corrige y vuelve a enviar: cada cambio crea una versión nueva.',
    ],
  },
  {
    role: 'APPROVER',
    title: 'Aprobador ("Autorizar viaje")',
    summary: 'Revisa precio, margen y condiciones antes de que la propuesta salga.',
    steps: [
      'En Aprobaciones ves las versiones que esperan tu autorización.',
      'Abre la versión, revisa costos, comisión y precio por alumno, y compara con la versión anterior si existe.',
      'Pulsa "Autorizar viaje" o devuélvela con un comentario para el cotizador.',
      'Tu tope de autorización depende de tu rol; si el total supera el tope, la autoriza alguien con tope mayor.',
    ],
  },
  {
    role: 'OFFICE_ADMIN',
    title: 'Coordinador de oficina',
    summary: 'Asigna el trabajo de su oficina y sigue los indicadores.',
    steps: [
      'Asigna cotizador a las solicitudes nuevas desde la solicitud o desde Mi trabajo.',
      'En Usuarios invita a la gente de tu oficina y dale su rol.',
      'En Dashboard ejecutivo sigue conversión, montos y la meta anual de tu oficina.',
      'La bitácora detallada de cada solicitud se abre desde la propia solicitud.',
    ],
  },
  {
    role: 'AUDITOR',
    title: 'Finanzas / auditor',
    summary: 'Consulta todo en solo lectura y valida las cifras.',
    steps: [
      'Abre cualquier cotización para ver costos, comisión y tipos de cambio usados (con su fuente y fecha).',
      'Desde Dashboard ejecutivo descarga el reporte financiero en Excel.',
      'Descarga la bitácora en CSV para revisar quién cambió qué y cuándo.',
      'Compara las cifras con tu Excel: si algo no cuadra, avisa con el folio.',
    ],
  },
  {
    role: 'SYSTEM_ADMIN',
    title: 'Administrador del sistema',
    summary: 'Configura oficinas, roles, tipos de cambio e integraciones.',
    steps: [
      'En Administración define qué puede ver, crear, editar y borrar cada rol, y las oficinas de cada usuario.',
      'Publica los tipos de cambio oficiales (o deja que Banxico los traiga cada día hábil).',
      'Configura alertas de vencimiento, reglas de autorización y metas anuales.',
      'Rubros y Proveedores son catálogos globales que solo tú editas.',
    ],
  },
];

export const guidesFor = (roles: string[]) => {
  const mine = GUIDES.filter((g) => roles.includes(g.role));
  return mine.length ? mine : GUIDES.slice(0, 1);
};
