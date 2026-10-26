// docs/guias/datos-ejemplo.ts — DOC-019, DOC-020 (P19.4), P24.6b
//
// Datos de ejemplo para las capturas de la app del empleado y del coordinador, y para las pantallas
// de administración que muestran jornadas de coordinadores. Las cuentas fijas de prueba
// (`e2e-fijo-*`) no tienen turnos, jornadas ni supervisiones, y para tener pantallas con contenido
// no se puede crear nada en `App_dev` (las capturas son de solo lectura). Entonces las respuestas
// de lectura del navegador (`/rest/v1/v_my_day`, `v_my_supervisions`, `v_supervisor_today`,
// `v_my_workdays`, `v_supervisor_workdays_admin`, etc.) se reemplazan, dentro del propio navegador
// de la captura, por los datos ficticios de este archivo. No se toca la base.
//
// Dos reglas de seguridad:
//  - Cualquier pedido que no sea de lectura (POST, PATCH, DELETE) contra la base o las funciones
//    se bloquea y se contesta con éxito falso: aunque un paso de captura hiciera clic donde no
//    debe, no se escribiría nada.
//  - Todo nombre, dirección y teléfono de acá es inventado. Ninguno es de una persona ni de un
//    cliente real.

import type { BrowserContext, Route } from '@playwright/test'

export type EscenarioEmpleado =
  'esperado' | 'en-curso' | 'finalizado' | 'con-demora' | 'sin-servicios'

/**
 * Escenarios del celular del coordinador (P24):
 * - `sin-jornada`: todavía no inició la jornada.
 * - `en-actividad`: jornada en marcha, con una pausa ya cerrada, sin supervisión abierta.
 * - `en-pausa`: jornada en pausa.
 * - `supervisando`: supervisión abierta; a una persona ya la calificó y a otra le falta.
 * - `por-cerrar`: supervisión abierta con todos calificados (se puede cerrar).
 * - `finalizada`: jornada finalizada, con una supervisión ya completada.
 * - `historial`: jornada de hoy y varios días anteriores (uno cerrado solo, uno corregido).
 */
export type EscenarioSupervisor =
  | 'sin-jornada'
  | 'en-actividad'
  | 'en-pausa'
  | 'supervisando'
  | 'por-cerrar'
  | 'finalizada'
  | 'historial'

/** Pantallas de administración con jornadas, preferencias y supervisiones de ejemplo. */
export type EscenarioAdmin = 'coordinadores'

export interface DatosDeEjemplo {
  /** Identificador de la sesión que se está usando (el `sub` del token). */
  usuarioId: string
  /** Si la persona ya dio su consentimiento de ubicación. */
  consentimiento: boolean
  empleado?: EscenarioEmpleado
  supervisor?: EscenarioSupervisor
  admin?: EscenarioAdmin
  /** Administración: identificador real del coordinador cuya ficha se muestra (cuenta fija). */
  coordinadorId?: string
}

const ZONA = 'America/Argentina/Buenos_Aires'

/**
 * "Ahora" de las capturas: la última vez que fueron las 9:30 en Argentina. Con el reloj del
 * navegador fijo en ese instante, el servicio de las 8 aparece "en curso desde las 8:05" y las
 * horas se ven coherentes sin importar a qué hora se corra el script.
 */
export function ahoraDeLasCapturas(real: Date = new Date()): Date {
  const hoyLocal = real.toLocaleDateString('en-CA', { timeZone: ZONA })
  const hoyALas0930 = new Date(`${hoyLocal}T09:30:00-03:00`)
  return real.getTime() >= hoyALas0930.getTime()
    ? hoyALas0930
    : new Date(hoyALas0930.getTime() - 86_400_000)
}

let ahora = ahoraDeLasCapturas()

function fechaLocal(desplazarDias = 0): string {
  const base = new Date(ahora.getTime() + desplazarDias * 86_400_000)
  return base.toLocaleDateString('en-CA', { timeZone: ZONA })
}

/** Instante ISO de unos minutos antes del "ahora" de las capturas. */
function instante(minutosAtras: number): string {
  return new Date(ahora.getTime() - minutosAtras * 60_000).toISOString()
}

const ID = {
  turno1: '11111111-1111-4111-8111-000000000001',
  turno2: '11111111-1111-4111-8111-000000000002',
  turno3: '11111111-1111-4111-8111-000000000003',
  turno4: '11111111-1111-4111-8111-000000000004',
  asignacion1: '22222222-2222-4222-8222-000000000001',
  asignacion2: '22222222-2222-4222-8222-000000000002',
  asignacion3: '22222222-2222-4222-8222-000000000003',
  asignacion4: '22222222-2222-4222-8222-000000000004',
  cliente1: '33333333-3333-4333-8333-000000000001',
  cliente2: '33333333-3333-4333-8333-000000000002',
  sede1: '44444444-4444-4444-8444-000000000001',
  sede2: '44444444-4444-4444-8444-000000000002',
  supervision1: '55555555-5555-4555-8555-000000000001',
  supervision2: '55555555-5555-4555-8555-000000000002',
  supervision3: '55555555-5555-4555-8555-000000000003',
  empleadoA: '66666666-6666-4666-8666-000000000001',
  empleadoB: '66666666-6666-4666-8666-000000000002',
  empleadoC: '66666666-6666-4666-8666-000000000003',
  empleadoD: '66666666-6666-4666-8666-000000000004',
  empleadoE: '66666666-6666-4666-8666-000000000005',
  empleadoF: '66666666-6666-4666-8666-000000000006',
  empleadoG: '66666666-6666-4666-8666-000000000007',
  empleadoH: '66666666-6666-4666-8666-000000000008',
  // Otros coordinadores (ficticios).
  coordinadorB: '66666666-6666-4666-8666-0000000000b1',
  coordinadorC: '66666666-6666-4666-8666-0000000000b2',
  coordinadorD: '66666666-6666-4666-8666-0000000000b3',
  coordinadorE: '66666666-6666-4666-8666-0000000000b4',
  coordinadorF: '66666666-6666-4666-8666-0000000000b5',
  coordinadorG: '66666666-6666-4666-8666-0000000000b6',
  turno5: '11111111-1111-4111-8111-000000000005',
  turno6: '11111111-1111-4111-8111-000000000006',
  turno7: '11111111-1111-4111-8111-000000000007',
  turno8: '11111111-1111-4111-8111-000000000008',
  asignacion5: '22222222-2222-4222-8222-000000000005',
  asignacion6: '22222222-2222-4222-8222-000000000006',
  asignacion7: '22222222-2222-4222-8222-000000000007',
  asignacion8: '22222222-2222-4222-8222-000000000008',
  asignacion9: '22222222-2222-4222-8222-000000000009',
  asignacion10: '22222222-2222-4222-8222-000000000010',
  cliente3: '33333333-3333-4333-8333-000000000003',
  sede3: '44444444-4444-4444-8444-000000000003',
  sede4: '44444444-4444-4444-8444-000000000004',
  supervision4: '55555555-5555-4555-8555-000000000004',
  supervision5: '55555555-5555-4555-8555-000000000005',
  supervision6: '55555555-5555-4555-8555-000000000006',
  supervision7: '55555555-5555-4555-8555-000000000007',
  supervision8: '55555555-5555-4555-8555-000000000008',
}

export const IDS_DE_EJEMPLO = ID

/** Hora de inicio y fin que se ven en las pantallas (formato `HH:MM:SS` como en la base). */
const FRANJA_1 = { inicio: '08:00:00', fin: '12:00:00' }

function filaMiDia(
  escenario: EscenarioEmpleado,
  usuarioId: string,
): Record<string, unknown>[] {
  const hoy = fechaLocal(0)
  const base = {
    is_today: true,
    shift_date: hoy,
    client_legal_name: 'Edificio Demo S.A.',
    client_trade_name: 'Edificio Demo',
    site_address: 'Av. Ejemplo 1234',
    site_city: 'Localidad de Ejemplo',
    site_latitude: -34.6,
    site_longitude: -58.45,
    site_contact_name: 'Encargado de ejemplo',
    site_contact_phone: '11 5555-0100',
    access_instructions:
      'Entrar por la puerta de servicio y avisar en la recepción.',
    building_hours: 'Lun a vie 7 a 20',
    phone_restricted: false,
    photos_not_allowed: true,
    restrictions_notes: null,
    effective_starts_at: null,
    effective_ends_at: null,
    shift_status: 'assigned',
    notes: null,
    changed_since_last_seen: false,
    check_in_at: null,
    check_out_at: null,
    check_in_source: null,
    check_in_recorded_by: null,
    check_out_source: null,
    check_out_recorded_by: null,
    last_notice_kind: null,
    last_notice_minutes_late: null,
    last_notice_reason_code: null,
    last_notice_reason_text: null,
    last_notice_reported_by: null,
    last_notice_source: null,
    last_notice_at: null,
  }
  const primera: Record<string, unknown> = {
    ...base,
    assignment_id: ID.asignacion1,
    shift_id: ID.turno1,
    client_id: ID.cliente1,
    site_id: ID.sede1,
    site_name: 'Sede Central',
    effective_start_time: FRANJA_1.inicio,
    effective_end_time: FRANJA_1.fin,
    status: 'expected',
    tasks_total: 6,
    tasks_done: 0,
  }
  if (escenario === 'en-curso') {
    primera.status = 'present'
    primera.check_in_at = instante(85)
    primera.check_in_source = 'employee_app'
    primera.check_in_recorded_by = usuarioId
    primera.tasks_done = 3
  } else if (escenario === 'finalizado') {
    primera.status = 'finished'
    primera.check_in_at = instante(85)
    primera.check_out_at = instante(5)
    primera.check_in_source = 'employee_app'
    primera.check_out_source = 'employee_app'
    primera.tasks_done = 5
    primera.notes = 'Quedó pendiente la limpieza del depósito: no había llave.'
  } else if (escenario === 'con-demora') {
    primera.status = 'delay_notified'
    primera.last_notice_kind = 'delay'
    primera.last_notice_minutes_late = 15
    primera.last_notice_source = 'employee_app'
    primera.last_notice_reported_by = usuarioId
    primera.last_notice_at = instante(20)
  }
  const segunda: Record<string, unknown> = {
    ...base,
    assignment_id: ID.asignacion2,
    shift_id: ID.turno2,
    client_id: ID.cliente2,
    site_id: ID.sede2,
    client_legal_name: 'Oficinas Muestra S.R.L.',
    client_trade_name: 'Oficinas Muestra',
    site_name: 'Sede Norte',
    site_address: 'Calle de Muestra 456',
    effective_start_time: '14:00:00',
    effective_end_time: '18:00:00',
    status: 'expected',
    tasks_total: 4,
    tasks_done: 0,
  }
  const manana: Record<string, unknown> = {
    ...base,
    assignment_id: ID.asignacion3,
    shift_id: ID.turno3,
    client_id: ID.cliente1,
    site_id: ID.sede1,
    is_today: false,
    shift_date: fechaLocal(1),
    site_name: 'Sede Central',
    effective_start_time: FRANJA_1.inicio,
    effective_end_time: FRANJA_1.fin,
    status: 'expected',
    tasks_total: 6,
    tasks_done: 0,
  }
  const pasadoManana: Record<string, unknown> = {
    ...manana,
    assignment_id: ID.asignacion4,
    shift_id: ID.turno4,
    shift_date: fechaLocal(2),
    client_id: ID.cliente2,
    site_id: ID.sede2,
    client_legal_name: 'Oficinas Muestra S.R.L.',
    client_trade_name: 'Oficinas Muestra',
    site_name: 'Sede Norte',
    effective_start_time: '14:00:00',
    effective_end_time: '18:00:00',
  }
  return escenario === 'sin-servicios'
    ? []
    : [primera, segunda, manana, pasadoManana]
}

function tareas(escenario: EscenarioEmpleado): Record<string, unknown>[] {
  const nuevas = (
    estados: Array<[string, boolean, string, string | null]>,
  ): Record<string, unknown>[] =>
    estados.map(([titulo, obligatoria, estado, motivo], i) => ({
      id: `77777777-7777-4777-8777-00000000000${i + 1}`,
      shift_id: ID.turno1,
      position: i + 1,
      title: titulo,
      description: null,
      is_required: obligatoria,
      status: estado,
      not_done_reason: motivo,
      status_changed_at: estado === 'pending' ? null : instante(30 - i),
      created_at: instante(1000),
      template_item_id: null,
      updated_at: null,
      updated_by: null,
    }))
  const hechas = escenario === 'esperado' || escenario === 'con-demora'
  return nuevas([
    [
      'Barrer y trapear los pisos de la planta baja',
      true,
      hechas ? 'pending' : 'done',
      null,
    ],
    [
      'Limpiar los baños y reponer papel',
      true,
      hechas ? 'pending' : 'done',
      null,
    ],
    [
      'Vaciar los tachos y cambiar las bolsas',
      true,
      hechas ? 'pending' : 'done',
      null,
    ],
    [
      'Limpiar los vidrios de la entrada',
      false,
      hechas ? 'pending' : escenario === 'finalizado' ? 'done' : 'pending',
      null,
    ],
    [
      'Desinfectar las superficies de la recepción',
      true,
      hechas ? 'pending' : escenario === 'finalizado' ? 'done' : 'pending',
      null,
    ],
    [
      'Ordenar el depósito de limpieza',
      false,
      hechas ? 'pending' : escenario === 'finalizado' ? 'not_done' : 'pending',
      escenario === 'finalizado' ? 'No había llave del depósito.' : null,
    ],
  ])
}

function compas(): Record<string, unknown>[] {
  return [
    {
      profile_id: ID.empleadoA,
      shift_id: ID.turno1,
      first_name: 'Ana',
      last_name: 'Ejemplo',
      avatar_path: null,
    },
  ]
}

/** Instante ISO de una hora de Argentina (`HH:MM`) de hoy o de otro día. */
function a(hora: string, desplazarDias = 0): string {
  return new Date(`${fechaLocal(desplazarDias)}T${hora}:00-03:00`).toISOString()
}

const CRITERIOS = [
  {
    id: '88888888-8888-4888-8888-000000000001',
    title: 'Puntualidad y presentación',
    description: 'Llega a horario, con uniforme completo y limpio.',
    position: 1,
  },
  {
    id: '88888888-8888-4888-8888-000000000002',
    title: 'Calidad de la limpieza',
    description: 'Los espacios quedan limpios y ordenados.',
    position: 2,
  },
  {
    id: '88888888-8888-4888-8888-000000000003',
    title: 'Trato y comunicación',
    description: 'Se comunica con respeto con el cliente y con el equipo.',
    position: 3,
  },
]

/** Empleados del turno 1 (Edificio Demo · Sede Central), con su asistencia de hoy. */
function empleadosDelTurno1() {
  return [
    {
      assignment_id: ID.asignacion1,
      employee_id: ID.empleadoA,
      first_name: 'Ana',
      last_name: 'Ejemplo',
      status: 'present',
      check_in_at: instante(85),
      check_out_at: null,
    },
    {
      assignment_id: ID.asignacion2,
      employee_id: ID.empleadoB,
      first_name: 'Beto',
      last_name: 'Muestra',
      status: 'present',
      check_in_at: instante(80),
      check_out_at: null,
    },
    {
      assignment_id: ID.asignacion3,
      employee_id: ID.empleadoC,
      first_name: 'Carla',
      last_name: 'Demo',
      status: 'absence_notified',
      check_in_at: null,
      check_out_at: null,
    },
  ]
}

/** Un empleado de otro turno, para armar la lista de «Hoy». */
function empleadoDeOtroTurno(
  asignacion: string,
  empleado: string,
  nombre: string,
  apellido: string,
  estado: string,
  entrada: string | null,
  salida: string | null,
) {
  return {
    assignment_id: asignacion,
    employee_id: empleado,
    first_name: nombre,
    last_name: apellido,
    status: estado,
    check_in_at: entrada,
    check_out_at: salida,
  }
}

/**
 * Los turnos de hoy de todos los clientes (`v_supervisor_today`): «Mis sedes» (Edificio Demo, dos
 * turnos) y «Otras sedes» (uno terminado, uno en curso que ya supervisa otro coordinador y uno
 * por empezar). La hora del navegador es las 9:30.
 */
function turnosDeHoy(
  escenario: EscenarioSupervisor,
  usuarioId: string,
): Record<string, unknown>[] {
  const yo = (
    supervisionId: string,
    estado: string,
    entrada: string,
    salida: string | null,
  ) => ({
    supervision_id: supervisionId,
    supervisor_id: usuarioId,
    first_name: 'Sofía',
    last_name: 'Ejemplo',
    status: estado,
    check_in_at: entrada,
    check_out_at: salida,
    is_me: true,
  })
  const otro = (
    supervisionId: string,
    supervisorId: string,
    nombre: string,
    apellido: string,
    estado: string,
    entrada: string,
    salida: string | null,
  ) => ({
    supervision_id: supervisionId,
    supervisor_id: supervisorId,
    first_name: nombre,
    last_name: apellido,
    status: estado,
    check_in_at: entrada,
    check_out_at: salida,
    is_me: false,
  })
  const base = {
    shift_date: fechaLocal(0),
    open_ended: false,
    site_city: 'Localidad de Ejemplo',
    site_radius_m: 100,
    max_accuracy_m: 50,
    my_supervision_id: null,
    my_supervision_status: null,
  }
  const tomado = escenario === 'supervisando' || escenario === 'por-cerrar'
  const terminado = escenario === 'finalizada' || escenario === 'historial'

  const turno1: Record<string, unknown> = {
    ...base,
    shift_id: ID.turno1,
    start_time: '08:00:00',
    end_time: '12:00:00',
    starts_at: a('08:00'),
    ends_at: a('12:00'),
    display_state: 'in_progress',
    required_staff: 3,
    client_id: ID.cliente1,
    client_legal_name: 'Edificio Demo S.A.',
    site_id: ID.sede1,
    site_name: 'Sede Central',
    site_address: 'Av. Ejemplo 1234',
    site_latitude: -34.6,
    site_longitude: -58.45,
    is_priority: true,
    assigned_employees: empleadosDelTurno1(),
    supervisors: tomado
      ? [yo(ID.supervision1, 'in_progress', instante(40), null)]
      : [],
  }
  if (tomado) {
    turno1.my_supervision_id = ID.supervision1
    turno1.my_supervision_status = 'in_progress'
  }

  const turnoAnexo: Record<string, unknown> = {
    ...base,
    shift_id: ID.turno5,
    start_time: '13:00:00',
    end_time: '17:00:00',
    starts_at: a('13:00'),
    ends_at: a('17:00'),
    display_state: 'pending',
    required_staff: 2,
    client_id: ID.cliente1,
    client_legal_name: 'Edificio Demo S.A.',
    site_id: ID.sede4,
    site_name: 'Sede Anexo',
    site_address: 'Calle Muestra 88',
    site_latitude: -34.61,
    site_longitude: -58.44,
    is_priority: true,
    assigned_employees: [
      empleadoDeOtroTurno(
        ID.asignacion5,
        ID.empleadoD,
        'Diego',
        'Prueba',
        'expected',
        null,
        null,
      ),
      empleadoDeOtroTurno(
        ID.asignacion6,
        ID.empleadoE,
        'Elena',
        'Modelo',
        'expected',
        null,
        null,
      ),
    ],
    supervisors: [],
  }

  const turnoNorte: Record<string, unknown> = {
    ...base,
    shift_id: ID.turno6,
    start_time: '06:00:00',
    end_time: '09:00:00',
    starts_at: a('06:00'),
    ends_at: a('09:00'),
    display_state: 'finished',
    required_staff: 1,
    client_id: ID.cliente2,
    client_legal_name: 'Oficinas Muestra S.R.L.',
    site_id: ID.sede2,
    site_name: 'Sede Norte',
    site_address: 'Calle de Muestra 456',
    site_latitude: -34.58,
    site_longitude: -58.43,
    is_priority: false,
    assigned_employees: [
      empleadoDeOtroTurno(
        ID.asignacion7,
        ID.empleadoF,
        'Fabián',
        'Ficticio',
        'finished',
        a('06:02'),
        a('08:58'),
      ),
    ],
    supervisors: terminado
      ? [yo(ID.supervision2, 'completed', instante(100), instante(40))]
      : [
          otro(
            ID.supervision4,
            ID.coordinadorB,
            'Julián',
            'Prueba',
            'completed',
            a('07:10'),
            a('07:50'),
          ),
        ],
  }
  if (terminado) {
    turnoNorte.my_supervision_id = ID.supervision2
    turnoNorte.my_supervision_status = 'completed'
  }

  const turnoClinica: Record<string, unknown> = {
    ...base,
    shift_id: ID.turno7,
    start_time: '07:00:00',
    end_time: '11:00:00',
    starts_at: a('07:00'),
    ends_at: a('11:00'),
    display_state: 'in_progress',
    required_staff: 2,
    client_id: ID.cliente3,
    client_legal_name: 'Clínica Ejemplo S.A.',
    site_id: ID.sede3,
    site_name: 'Consultorios',
    site_address: 'Av. Demo 900',
    site_latitude: -34.62,
    site_longitude: -58.42,
    is_priority: false,
    assigned_employees: [
      empleadoDeOtroTurno(
        ID.asignacion8,
        ID.empleadoG,
        'Gisela',
        'Ejemplo',
        'present',
        a('07:03'),
        null,
      ),
      empleadoDeOtroTurno(
        ID.asignacion9,
        ID.empleadoH,
        'Hugo',
        'Muestra',
        'present',
        a('07:05'),
        null,
      ),
    ],
    supervisors: [
      otro(
        ID.supervision5,
        ID.coordinadorC,
        'Irene',
        'Demo',
        'in_progress',
        instante(30),
        null,
      ),
    ],
  }

  const turnoTarde: Record<string, unknown> = {
    ...base,
    shift_id: ID.turno8,
    start_time: '14:00:00',
    end_time: '18:00:00',
    starts_at: a('14:00'),
    ends_at: a('18:00'),
    display_state: 'pending',
    required_staff: 1,
    client_id: ID.cliente2,
    client_legal_name: 'Oficinas Muestra S.R.L.',
    site_id: ID.sede2,
    site_name: 'Sede Norte',
    site_address: 'Calle de Muestra 456',
    site_latitude: -34.58,
    site_longitude: -58.43,
    is_priority: false,
    assigned_employees: [
      empleadoDeOtroTurno(
        ID.asignacion10,
        ID.empleadoF,
        'Fabián',
        'Ficticio',
        'expected',
        null,
        null,
      ),
    ],
    supervisors: [],
  }

  return [turno1, turnoAnexo, turnoNorte, turnoClinica, turnoTarde]
}

/** Una supervisión propia (`v_my_supervisions`), con los datos de la sede de ejemplo. */
function filaSupervision(
  datos: Record<string, unknown>,
): Record<string, unknown> {
  return {
    shift_id: ID.turno1,
    shift_date: fechaLocal(0),
    client_id: ID.cliente1,
    client_legal_name: 'Edificio Demo S.A.',
    site_id: ID.sede1,
    site_name: 'Sede Central',
    site_address: 'Av. Ejemplo 1234',
    site_city: 'Localidad de Ejemplo',
    site_latitude: -34.6,
    site_longitude: -58.45,
    site_contact_name: 'Encargado de ejemplo',
    site_contact_phone: '11 5555-0100',
    site_access_instructions:
      'Entrar por la puerta de servicio y avisar en la recepción.',
    site_building_hours: 'Lun a vie 7 a 20',
    site_phone_restricted: false,
    site_photos_not_allowed: true,
    site_restrictions_notes: null,
    start_time: '08:00:00',
    end_time: '12:00:00',
    starts_at: a('08:00'),
    ends_at: a('12:00'),
    assigned_at: null,
    not_done_reason: null,
    cancel_reason: null,
    general_notes: null,
    criteria_snapshot: CRITERIOS,
    check_in_at: null,
    check_out_at: null,
    ...datos,
  }
}

function filasSupervision(
  escenario: EscenarioSupervisor,
): Record<string, unknown>[] {
  const asignados = empleadosDelTurno1().map((e) => ({
    employee_id: e.employee_id,
    first_name: e.first_name,
    last_name: e.last_name,
    status: e.status,
    check_in_at: e.check_in_at,
  }))
  const abierta = filaSupervision({
    id: ID.supervision1,
    status: 'in_progress',
    check_in_at: instante(40),
    assigned_employees: asignados,
  })
  const norte = filaSupervision({
    id: ID.supervision2,
    shift_id: ID.turno6,
    client_id: ID.cliente2,
    client_legal_name: 'Oficinas Muestra S.R.L.',
    site_id: ID.sede2,
    site_name: 'Sede Norte',
    site_address: 'Calle de Muestra 456',
    start_time: '06:00:00',
    end_time: '09:00:00',
    starts_at: a('06:00'),
    ends_at: a('09:00'),
    status: 'completed',
    check_in_at: instante(100),
    check_out_at: instante(40),
    assigned_employees: [
      {
        employee_id: ID.empleadoF,
        first_name: 'Fabián',
        last_name: 'Ficticio',
        status: 'finished',
        check_in_at: a('06:02'),
      },
    ],
  })
  const vieja = filaSupervision({
    id: ID.supervision3,
    shift_date: fechaLocal(-1),
    status: 'completed',
    check_in_at: a('09:10', -1),
    check_out_at: a('09:55', -1),
    assigned_employees: asignados,
  })
  if (escenario === 'supervisando' || escenario === 'por-cerrar') {
    return [abierta, vieja]
  }
  if (escenario === 'finalizada') return [norte]
  if (escenario === 'historial') return [norte, vieja]
  return []
}

/** Una jornada propia (`v_my_workdays`) con sus valores por omisión. */
function filaJornada(datos: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '12121212-1212-4212-8212-000000000001',
    work_date: fechaLocal(0),
    state: 'running',
    started_at: instante(120),
    ended_at: null,
    worked_minutes: 120,
    pause_minutes: 0,
    auto_closed: false,
    auto_close_warning: false,
    corrected: false,
    pauses: [],
    supervisions: [],
    supervisions_count: 0,
    events: [],
    ...datos,
  }
}

function jornadasPropias(
  escenario: EscenarioSupervisor,
): Record<string, unknown>[] {
  const desayuno = {
    type: 'pause',
    starts_at: instante(60),
    ends_at: instante(35),
    minutes: 25,
    reason: 'Desayuno',
  }
  const supervisionAbierta = {
    supervision_id: ID.supervision1,
    shift_id: ID.turno1,
    client_legal_name: 'Edificio Demo S.A.',
    site_name: 'Sede Central',
    status: 'in_progress',
    check_in_at: instante(40),
    check_out_at: null,
    duration_minutes: null,
    unclosed: false,
  }
  const supervisionNorte = {
    supervision_id: ID.supervision2,
    shift_id: ID.turno6,
    client_legal_name: 'Oficinas Muestra S.R.L.',
    site_name: 'Sede Norte',
    status: 'completed',
    check_in_at: instante(100),
    check_out_at: instante(40),
    duration_minutes: 60,
    unclosed: false,
  }
  const hoyFinalizada = filaJornada({
    state: 'ended',
    ended_at: instante(10),
    worked_minutes: 85,
    pause_minutes: 25,
    pauses: [desayuno],
    supervisions: [supervisionNorte],
    supervisions_count: 1,
  })
  switch (escenario) {
    case 'sin-jornada':
      return []
    case 'en-actividad':
      return [
        filaJornada({
          worked_minutes: 95,
          pause_minutes: 25,
          pauses: [desayuno],
        }),
      ]
    case 'en-pausa':
      return [
        filaJornada({
          state: 'paused',
          worked_minutes: 105,
          pause_minutes: 15,
          pauses: [
            {
              type: 'pause',
              starts_at: instante(15),
              ends_at: null,
              minutes: 15,
              reason: 'Trámite en el banco',
            },
          ],
        }),
      ]
    case 'supervisando':
    case 'por-cerrar':
      return [
        filaJornada({
          worked_minutes: 95,
          pause_minutes: 25,
          pauses: [desayuno],
          supervisions: [supervisionAbierta],
          supervisions_count: 1,
        }),
      ]
    case 'finalizada':
      return [hoyFinalizada]
    case 'historial': {
      const dia = (n: number, datos: Record<string, unknown>) =>
        filaJornada({
          id: `12121212-1212-4212-8212-00000000000${n + 1}`,
          work_date: fechaLocal(-n),
          ...datos,
        })
      return [
        hoyFinalizada,
        dia(1, {
          state: 'ended',
          started_at: a('08:00', -1),
          ended_at: a('17:30', -1),
          worked_minutes: 450,
          pause_minutes: 60,
          pauses: [
            {
              type: 'pause',
              starts_at: a('12:30', -1),
              ends_at: a('13:30', -1),
              minutes: 60,
              reason: 'Almuerzo',
            },
          ],
          supervisions: [
            {
              supervision_id: ID.supervision3,
              shift_id: ID.turno3,
              client_legal_name: 'Edificio Demo S.A.',
              site_name: 'Sede Central',
              status: 'completed',
              check_in_at: a('09:10', -1),
              check_out_at: a('09:55', -1),
              duration_minutes: 45,
              unclosed: false,
            },
            {
              supervision_id: ID.supervision6,
              shift_id: ID.turno4,
              client_legal_name: 'Oficinas Muestra S.R.L.',
              site_name: 'Sede Norte',
              status: 'completed',
              check_in_at: a('14:20', -1),
              check_out_at: a('15:10', -1),
              duration_minutes: 50,
              unclosed: false,
            },
          ],
          supervisions_count: 2,
        }),
        dia(2, {
          state: 'ended',
          started_at: a('07:45', -2),
          ended_at: a('23:55', -2),
          worked_minutes: 970,
          auto_closed: true,
          auto_close_warning: true,
          supervisions: [
            {
              supervision_id: ID.supervision7,
              shift_id: ID.turno4,
              client_legal_name: 'Clínica Ejemplo S.A.',
              site_name: 'Consultorios',
              status: 'in_progress',
              check_in_at: a('16:00', -2),
              check_out_at: a('23:55', -2),
              duration_minutes: 475,
              unclosed: true,
            },
          ],
          supervisions_count: 1,
        }),
        dia(3, {
          state: 'ended',
          started_at: a('08:00', -3),
          ended_at: a('16:00', -3),
          worked_minutes: 450,
          pause_minutes: 30,
          corrected: true,
          pauses: [
            {
              type: 'pause',
              starts_at: a('12:00', -3),
              ends_at: a('12:30', -3),
              minutes: 30,
              reason: null,
            },
          ],
        }),
      ]
    }
  }
}

function criteriosVigentes(): Record<string, unknown>[] {
  return [
    {
      id: '88888888-8888-4888-8888-000000000001',
      title: 'Puntualidad y presentación',
      description: 'Llega a horario, con uniforme completo y limpio.',
      position: 1,
      valid_from: '2026-01-01',
      valid_to: null,
    },
    {
      id: '88888888-8888-4888-8888-000000000002',
      title: 'Calidad de la limpieza',
      description: 'Los espacios quedan limpios y ordenados.',
      position: 2,
      valid_from: '2026-01-01',
      valid_to: null,
    },
    {
      id: '88888888-8888-4888-8888-000000000003',
      title: 'Trato y comunicación',
      description: 'Se comunica con respeto con el cliente y con el equipo.',
      position: 3,
      valid_from: '2026-01-01',
      valid_to: null,
    },
  ]
}

function calificaciones(
  escenario: EscenarioSupervisor | undefined,
): Record<string, unknown>[] {
  const fila = (
    supervision: string,
    asignacion: string,
    puntaje: number,
    comentario: string | null,
    n: number,
  ) => ({
    id: `99999999-9999-4999-8999-00000000000${n}`,
    supervision_id: supervision,
    assignment_id: asignacion,
    score: puntaje,
    comment: comentario,
    created_at: instante(20),
    created_by: null,
    updated_at: null,
    updated_by: null,
    updated_by_profile: null,
  })
  if (escenario === 'supervisando') {
    return [fila(ID.supervision1, ID.asignacion1, 5, null, 1)]
  }
  if (escenario === 'por-cerrar') {
    return [
      fila(ID.supervision1, ID.asignacion1, 5, null, 1),
      fila(ID.supervision1, ID.asignacion2, 4, 'Faltó repasar los vidrios.', 2),
    ]
  }
  if (escenario === 'finalizada' || escenario === 'historial') {
    return [fila(ID.supervision2, ID.asignacion7, 5, null, 3)]
  }
  return []
}

function perfilDeEjemplo(
  datos: DatosDeEjemplo,
  esSupervisor: boolean,
): Record<string, unknown> {
  return {
    id: datos.usuarioId,
    first_name: esSupervisor ? 'Sofía' : 'Laura',
    last_name: 'Ejemplo',
    contact_email: null,
    phone: null,
    avatar_path: null,
    location_consent_at: datos.consentimiento ? instante(60 * 24 * 10) : null,
  }
}

function aplicarFiltros(
  filas: Record<string, unknown>[],
  parametros: URLSearchParams,
): Record<string, unknown>[] {
  let resultado = filas
  for (const [clave, valor] of parametros.entries()) {
    if (['select', 'order', 'limit', 'offset', 'or', 'and'].includes(clave)) {
      continue
    }
    const igual = /^eq\.(.*)$/.exec(valor)
    const lista = /^in\.\((.*)\)$/.exec(valor)
    if (igual) {
      resultado = resultado.filter(
        (fila) => !(clave in fila) || String(fila[clave]) === igual[1],
      )
    } else if (lista) {
      const valores = lista[1].split(',').map((v) => v.replace(/^"|"$/g, ''))
      resultado = resultado.filter(
        (fila) => !(clave in fila) || valores.includes(String(fila[clave])),
      )
    }
  }
  return resultado
}

async function responder(
  ruta: Route,
  filas: Record<string, unknown>[],
  comoObjeto: boolean,
): Promise<void> {
  const cabeceras = {
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'Content-Range',
    'content-range': `0-${Math.max(filas.length - 1, 0)}/${filas.length}`,
  }
  if (comoObjeto) {
    if (filas.length === 0) {
      await ruta.fulfill({
        status: 406,
        headers: cabeceras,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'PGRST116',
          details: 'The result contains 0 rows',
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        }),
      })
      return
    }
    await ruta.fulfill({
      status: 200,
      headers: cabeceras,
      contentType: 'application/vnd.pgrst.object+json',
      body: JSON.stringify(filas[0]),
    })
    return
  }
  await ruta.fulfill({
    status: 200,
    headers: cabeceras,
    contentType: 'application/json',
    body: JSON.stringify(filas),
  })
}

// ---- Administración: coordinadores de ejemplo ------------------------------------------------

/**
 * Instante ISO de unos minutos antes de "ahora", sin pasar de las 00:05 de hoy (así una jornada
 * "de hoy" nunca queda en el día anterior aunque el script corra de madrugada).
 */
function instanteDeHoy(minutosAtras: number): string {
  const inicio = new Date(`${fechaLocal(0)}T00:05:00-03:00`).getTime()
  return new Date(
    Math.max(ahora.getTime() - minutosAtras * 60_000, inicio),
  ).toISOString()
}

/** Cliente real de la ficha que se está mostrando (lo fija la captura, ver `fijarClienteDeEjemplo`). */
let clienteDeEjemplo: string | null = null

/**
 * La captura de la ficha del cliente avisa cuál es el cliente real que abrió, para que el bloque
 * «Coordinadores preferenciales» tenga a quién mostrar. Se borra al armar cada captura.
 */
export function fijarClienteDeEjemplo(clienteId: string | null): void {
  clienteDeEjemplo = clienteId
}

function estadoDeCoordinadores(
  coordinadorId: string,
): Record<string, unknown>[] {
  const fila = (
    supervisorId: string,
    nombre: string,
    apellido: string,
    estado: string,
    extra: Record<string, unknown>,
  ) => ({
    supervisor_id: supervisorId,
    first_name: nombre,
    last_name: apellido,
    status: estado,
    workday_id:
      estado === 'not_started'
        ? null
        : `13131313-1313-4313-8313-0000000000${supervisorId.slice(-2)}`,
    work_date: fechaLocal(0),
    started_at: null,
    ended_at: null,
    last_event_at: null,
    latitude: null,
    longitude: null,
    accuracy_m: null,
    worked_minutes: 0,
    pause_reason: null,
    supervision_id: null,
    client_id: null,
    client_legal_name: null,
    site_id: null,
    site_name: null,
    auto_closed: false,
    corrected: false,
    on_leave: false,
    ...extra,
  })
  return [
    fila(coordinadorId, 'Sofía', 'Ejemplo', 'supervising', {
      started_at: instanteDeHoy(150),
      last_event_at: instanteDeHoy(40),
      latitude: -34.6003,
      longitude: -58.4502,
      accuracy_m: 12,
      worked_minutes: 125,
      supervision_id: ID.supervision1,
      client_id: ID.cliente1,
      client_legal_name: 'Edificio Demo S.A.',
      site_id: ID.sede1,
      site_name: 'Sede Central',
    }),
    fila(ID.coordinadorB, 'Julián', 'Prueba', 'in_activity', {
      started_at: instanteDeHoy(170),
      last_event_at: instanteDeHoy(25),
      latitude: -34.618,
      longitude: -58.39,
      accuracy_m: 18,
      worked_minutes: 160,
    }),
    fila(ID.coordinadorC, 'Irene', 'Demo', 'supervising', {
      started_at: instanteDeHoy(160),
      last_event_at: instanteDeHoy(30),
      latitude: -34.6205,
      longitude: -58.421,
      accuracy_m: 10,
      worked_minutes: 140,
      supervision_id: ID.supervision5,
      client_id: ID.cliente3,
      client_legal_name: 'Clínica Ejemplo S.A.',
      site_id: ID.sede3,
      site_name: 'Consultorios',
    }),
    fila(ID.coordinadorD, 'Hugo', 'Muestra', 'paused', {
      started_at: instanteDeHoy(220),
      last_event_at: instanteDeHoy(12),
      latitude: -34.579,
      longitude: -58.431,
      accuracy_m: 20,
      worked_minutes: 200,
      pause_reason: 'Almuerzo',
    }),
    fila(ID.coordinadorE, 'Fabián', 'Ficticio', 'finished', {
      started_at: instanteDeHoy(400),
      ended_at: instanteDeHoy(60),
      last_event_at: instanteDeHoy(60),
      latitude: -34.595,
      longitude: -58.46,
      accuracy_m: 15,
      worked_minutes: 300,
    }),
    fila(ID.coordinadorF, 'Gisela', 'Ejemplo', 'in_activity', {
      started_at: instanteDeHoy(90),
      last_event_at: instanteDeHoy(90),
      worked_minutes: 90,
    }),
    fila(ID.coordinadorG, 'Beto', 'Demo', 'not_started', {}),
  ]
}

function jornadasAdmin(coordinadorId: string): Record<string, unknown>[] {
  let n = 0
  const evento = (
    tipo: string,
    cuando: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id: `14141414-1414-4414-8414-0000000000${String(++n).padStart(2, '0')}`,
    kind: tipo,
    recorded_at: cuando,
    reason: null,
    supervision_id: null,
    has_position: true,
    corrected: false,
    corrected_from: null,
    correction_reason: null,
    removed: false,
    ...extra,
  })
  const jornada = (
    dia: number,
    datos: Record<string, unknown>,
  ): Record<string, unknown> => ({
    id: `13131313-1313-4313-8313-00000000009${dia}`,
    supervisor_id: coordinadorId,
    supervisor_first_name: 'Sofía',
    supervisor_last_name: 'Ejemplo',
    work_date: fechaLocal(-dia),
    state: 'ended',
    pause_minutes: 0,
    auto_closed: false,
    auto_close_warning: false,
    corrected: false,
    pauses: [],
    supervisions: [],
    supervisions_count: 0,
    ...datos,
  })
  const supervision = (
    id: string,
    cliente: string,
    sede: string,
    entrada: string,
    salida: string | null,
    minutos: number | null,
    extra: Record<string, unknown> = {},
  ) => ({
    supervision_id: id,
    shift_id: ID.turno1,
    client_id: ID.cliente1,
    client_legal_name: cliente,
    site_id: ID.sede1,
    site_name: sede,
    status: 'completed',
    check_in_at: entrada,
    check_out_at: salida,
    duration_minutes: minutos,
    unclosed: false,
    ...extra,
  })

  const hoyInicio = instanteDeHoy(150)
  const hoyPausa = instanteDeHoy(60)
  const hoyReanuda = instanteDeHoy(35)
  const hoy = jornada(0, {
    work_date: fechaLocal(0),
    state: 'running',
    started_at: hoyInicio,
    ended_at: null,
    worked_minutes: 125,
    pause_minutes: 25,
    pauses: [
      {
        type: 'pause',
        pause_event_id: '14141414-1414-4414-8414-000000000101',
        resume_event_id: '14141414-1414-4414-8414-000000000102',
        starts_at: hoyPausa,
        ends_at: hoyReanuda,
        minutes: 25,
        reason: 'Desayuno',
        corrected: false,
      },
    ],
    supervisions: [
      supervision(
        ID.supervision1,
        'Edificio Demo S.A.',
        'Sede Central',
        instanteDeHoy(40),
        null,
        null,
        { status: 'in_progress' },
      ),
    ],
    supervisions_count: 1,
    events: [
      evento('start', hoyInicio),
      evento('pause', hoyPausa, { reason: 'Desayuno' }),
      evento('resume', hoyReanuda),
      evento('supervision_start', instanteDeHoy(40), {
        supervision_id: ID.supervision1,
      }),
    ],
  })

  const ayer = jornada(1, {
    started_at: a('08:00', -1),
    ended_at: a('17:30', -1),
    worked_minutes: 450,
    pause_minutes: 60,
    pauses: [
      {
        type: 'pause',
        pause_event_id: '14141414-1414-4414-8414-000000000111',
        resume_event_id: '14141414-1414-4414-8414-000000000112',
        starts_at: a('12:30', -1),
        ends_at: a('13:30', -1),
        minutes: 60,
        reason: 'Almuerzo',
        corrected: false,
      },
    ],
    supervisions: [
      supervision(
        ID.supervision3,
        'Edificio Demo S.A.',
        'Sede Central',
        a('09:10', -1),
        a('09:55', -1),
        45,
      ),
      supervision(
        ID.supervision6,
        'Oficinas Muestra S.R.L.',
        'Sede Norte',
        a('14:20', -1),
        a('15:10', -1),
        50,
      ),
    ],
    supervisions_count: 2,
    events: [
      evento('start', a('08:00', -1)),
      evento('supervision_start', a('09:10', -1)),
      evento('supervision_end', a('09:55', -1)),
      evento('pause', a('12:30', -1), { reason: 'Almuerzo' }),
      evento('resume', a('13:30', -1)),
      evento('supervision_start', a('14:20', -1)),
      evento('supervision_end', a('15:10', -1)),
      evento('end', a('17:30', -1)),
    ],
  })

  const cerradaSola = jornada(2, {
    started_at: a('07:45', -2),
    ended_at: a('23:55', -2),
    worked_minutes: 970,
    auto_closed: true,
    auto_close_warning: true,
    supervisions: [
      supervision(
        ID.supervision7,
        'Clínica Ejemplo S.A.',
        'Consultorios',
        a('16:00', -2),
        a('23:55', -2),
        475,
        { status: 'in_progress', unclosed: true },
      ),
    ],
    supervisions_count: 1,
    events: [
      evento('start', a('07:45', -2)),
      evento('supervision_start', a('16:00', -2)),
      evento('supervision_end', a('23:55', -2), { has_position: false }),
      evento('end', a('23:55', -2), { has_position: false }),
    ],
  })

  const corregida = jornada(3, {
    started_at: a('08:00', -3),
    ended_at: a('16:00', -3),
    worked_minutes: 450,
    pause_minutes: 30,
    corrected: true,
    pauses: [
      {
        type: 'pause',
        pause_event_id: '14141414-1414-4414-8414-000000000131',
        resume_event_id: '14141414-1414-4414-8414-000000000132',
        starts_at: a('12:00', -3),
        ends_at: a('12:30', -3),
        minutes: 30,
        reason: null,
        corrected: false,
      },
    ],
    events: [
      evento('start', a('08:00', -3)),
      evento('pause', a('12:00', -3)),
      evento('resume', a('12:30', -3)),
      evento('end', a('16:00', -3), {
        corrected: true,
        corrected_from: a('23:55', -3),
        correction_reason:
          'Terminó a las 16:00 y no pudo finalizar la jornada desde el celular.',
      }),
    ],
  })

  return [hoy, ayer, cerradaSola, corregida]
}

function prioridadesDeEjemplo(
  coordinadorId: string,
): Record<string, unknown>[] {
  const quien = (nombre: string, apellido: string) => ({
    profiles: { first_name: nombre, last_name: apellido },
  })
  const cliente = (legal: string, comercial: string) => ({
    legal_name: legal,
    trade_name: comercial,
  })
  const filas: Record<string, unknown>[] = [
    {
      id: '15151515-1515-4515-8515-000000000001',
      supervisor_id: coordinadorId,
      client_id: ID.cliente1,
      site_id: null,
      created_at: instante(60 * 24 * 20),
      employees: quien('Sofía', 'Ejemplo'),
      client: cliente('Edificio Demo S.A.', 'Edificio Demo'),
      site: null,
    },
    {
      id: '15151515-1515-4515-8515-000000000002',
      supervisor_id: coordinadorId,
      client_id: null,
      site_id: ID.sede2,
      created_at: instante(60 * 24 * 12),
      employees: quien('Sofía', 'Ejemplo'),
      client: null,
      site: {
        name: 'Sede Norte',
        client_id: ID.cliente2,
        clients: cliente('Oficinas Muestra S.R.L.', 'Oficinas Muestra'),
      },
    },
  ]
  if (clienteDeEjemplo) {
    filas.push(
      {
        id: '15151515-1515-4515-8515-000000000003',
        supervisor_id: coordinadorId,
        client_id: clienteDeEjemplo,
        site_id: null,
        created_at: instante(60 * 24 * 5),
        employees: quien('Sofía', 'Ejemplo'),
        client: cliente('Cliente de ejemplo', 'Cliente de ejemplo'),
        site: null,
      },
      {
        id: '15151515-1515-4515-8515-000000000004',
        supervisor_id: ID.coordinadorB,
        client_id: clienteDeEjemplo,
        site_id: null,
        created_at: instante(60 * 24 * 3),
        employees: quien('Julián', 'Prueba'),
        client: cliente('Cliente de ejemplo', 'Cliente de ejemplo'),
        site: null,
      },
    )
  }
  return filas
}

function supervisionesAdmin(coordinadorId: string): Record<string, unknown>[] {
  const fila = (datos: Record<string, unknown>): Record<string, unknown> => ({
    shift_id: ID.turno1,
    shift_date: fechaLocal(0),
    client_id: ID.cliente1,
    client_legal_name: 'Edificio Demo S.A.',
    site_id: ID.sede1,
    site_name: 'Sede Central',
    start_time: '08:00:00',
    end_time: '12:00:00',
    shift_open_ended: false,
    supervisor_id: coordinadorId,
    supervisor_first_name: 'Sofía',
    supervisor_last_name: 'Ejemplo',
    assigned_at: instante(60 * 24),
    check_in_at: null,
    check_out_at: null,
    general_notes: null,
    cancel_reason: null,
    not_done_reason: null,
    criteria_snapshot: CRITERIOS,
    ratings_count: 0,
    ratings_avg: null,
    assigned_employees_count: 3,
    planned_minutes: null,
    worked_minutes: null,
    workday_id: null,
    duration_minutes: null,
    unclosed: false,
    workday_auto_closed: false,
    check_in_record_id: null,
    check_in_geo_status: null,
    check_in_geo_reason: null,
    check_in_distance_m: null,
    check_in_geofence_radius_m: null,
    check_in_accuracy_m: null,
    check_in_outside_reason: null,
    check_in_geo_overridden: null,
    check_out_record_id: null,
    check_out_geo_status: null,
    check_out_geo_reason: null,
    check_out_distance_m: null,
    check_out_geofence_radius_m: null,
    check_out_accuracy_m: null,
    check_out_outside_reason: null,
    check_out_geo_overridden: null,
    ...datos,
  })
  return [
    fila({
      id: ID.supervision1,
      status: 'in_progress',
      check_in_at: instanteDeHoy(40),
      ratings_count: 1,
      ratings_avg: 5,
    }),
    fila({
      id: ID.supervision5,
      shift_id: ID.turno7,
      client_id: ID.cliente3,
      client_legal_name: 'Clínica Ejemplo S.A.',
      site_id: ID.sede3,
      site_name: 'Consultorios',
      start_time: '07:00:00',
      end_time: '11:00:00',
      supervisor_id: ID.coordinadorC,
      supervisor_first_name: 'Irene',
      supervisor_last_name: 'Demo',
      status: 'in_progress',
      check_in_at: instanteDeHoy(30),
      assigned_employees_count: 2,
    }),
    fila({
      id: ID.supervision3,
      shift_date: fechaLocal(-1),
      status: 'completed',
      check_in_at: a('09:10', -1),
      check_out_at: a('09:55', -1),
      duration_minutes: 45,
      ratings_count: 3,
      ratings_avg: 4.3,
    }),
    fila({
      id: ID.supervision4,
      shift_id: ID.turno6,
      shift_date: fechaLocal(-1),
      client_id: ID.cliente2,
      client_legal_name: 'Oficinas Muestra S.R.L.',
      site_id: ID.sede2,
      site_name: 'Sede Norte',
      start_time: '06:00:00',
      end_time: '09:00:00',
      supervisor_id: ID.coordinadorB,
      supervisor_first_name: 'Julián',
      supervisor_last_name: 'Prueba',
      status: 'completed',
      check_in_at: a('07:10', -1),
      check_out_at: a('07:50', -1),
      duration_minutes: 40,
      ratings_count: 1,
      ratings_avg: 4,
      assigned_employees_count: 1,
    }),
    fila({
      id: ID.supervision7,
      shift_id: ID.turno7,
      shift_date: fechaLocal(-2),
      client_id: ID.cliente3,
      client_legal_name: 'Clínica Ejemplo S.A.',
      site_id: ID.sede3,
      site_name: 'Consultorios',
      start_time: '14:00:00',
      end_time: '18:00:00',
      status: 'in_progress',
      check_in_at: a('16:00', -2),
      check_out_at: a('23:55', -2),
      duration_minutes: 475,
      unclosed: true,
      workday_auto_closed: true,
      workday_id: '13131313-1313-4313-8313-000000000092',
      ratings_count: 1,
      ratings_avg: 4,
      assigned_employees_count: 2,
    }),
    fila({
      id: ID.supervision8,
      shift_id: ID.turno6,
      shift_date: fechaLocal(-3),
      client_id: ID.cliente2,
      client_legal_name: 'Oficinas Muestra S.R.L.',
      site_id: ID.sede2,
      site_name: 'Sede Norte',
      start_time: '06:00:00',
      end_time: '09:00:00',
      supervisor_id: ID.coordinadorB,
      supervisor_first_name: 'Julián',
      supervisor_last_name: 'Prueba',
      status: 'cancelled',
      cancel_reason: 'Descartada por el coordinador',
      assigned_employees_count: 1,
    }),
  ]
}

/** Asignaciones con el nombre del empleado, como las lee el detalle de una supervisión en administración. */
function asignacionesAdmin(): Record<string, unknown>[] {
  const fila = (
    id: string,
    turno: string,
    empleado: string,
    nombre: string,
    apellido: string,
  ) => ({
    id,
    shift_id: turno,
    employee_id: empleado,
    removed_at: null,
    employees: {
      profile_id: empleado,
      profiles: { first_name: nombre, last_name: apellido },
    },
  })
  return [
    fila(ID.asignacion1, ID.turno1, ID.empleadoA, 'Ana', 'Ejemplo'),
    fila(ID.asignacion2, ID.turno1, ID.empleadoB, 'Beto', 'Muestra'),
    fila(ID.asignacion3, ID.turno1, ID.empleadoC, 'Carla', 'Demo'),
    fila(ID.asignacion8, ID.turno7, ID.empleadoG, 'Gisela', 'Ejemplo'),
    fila(ID.asignacion9, ID.turno7, ID.empleadoH, 'Hugo', 'Muestra'),
  ]
}

function tablasDeAdministracion(
  escenario: EscenarioAdmin,
  coordinadorId: string,
): Record<string, Record<string, unknown>[]> {
  // Un único escenario por ahora; el parámetro deja la puerta abierta a otros.
  void escenario
  return {
    v_supervisor_status: estadoDeCoordinadores(coordinadorId),
    v_supervisor_workdays_admin: jornadasAdmin(coordinadorId),
    supervisor_priorities: prioridadesDeEjemplo(coordinadorId),
    v_supervisions_admin: supervisionesAdmin(coordinadorId),
    assignments: asignacionesAdmin(),
    ratings: [
      {
        id: '99999999-9999-4999-8999-000000000001',
        supervision_id: ID.supervision1,
        assignment_id: ID.asignacion1,
        score: 5,
        comment: 'Muy buen trabajo en los pisos.',
        created_at: instanteDeHoy(20),
        updated_at: null,
        updated_by: null,
        updated_by_profile: null,
      },
    ],
  }
}

/** Funciones de la base declaradas `stable` (no escriben nada) que la app llama con POST. */
const RPC_DE_SOLO_LECTURA = ['storage_usage', 'clients_worked_minutes']

/** Pedidos de lectura que no se reemplazaron y salieron a la base real (para revisar). */
export const LECTURAS_REALES = new Set<string>()
/** Pedidos de escritura que se bloquearon (tiene que quedar en cero si no se hizo clic en nada). */
export const ESCRITURAS_BLOQUEADAS: string[] = []

export async function instalarDatosDeEjemplo(
  contexto: BrowserContext,
  datos: DatosDeEjemplo,
): Promise<void> {
  const esAdmin = datos.admin !== undefined
  if (esAdmin) {
    // Administración lee los datos reales de `App_dev` con el reloj real: solo se reemplazan las
    // lecturas de coordinadores, y los horarios inventados se calculan respecto de "ahora".
    ahora = new Date()
    clienteDeEjemplo = null
  } else {
    ahora = ahoraDeLasCapturas()
    await contexto.clock.setFixedTime(ahora)
  }
  const esSupervisor = datos.supervisor !== undefined
  let tablas: Record<string, Record<string, unknown>[]>
  if (esAdmin && datos.admin) {
    tablas = tablasDeAdministracion(
      datos.admin,
      datos.coordinadorId ?? ID.coordinadorB,
    )
  } else {
    const miDia = filaMiDia(datos.empleado ?? 'esperado', datos.usuarioId)
    const escenario = datos.supervisor ?? 'sin-jornada'
    tablas = {
      v_my_day: miDia,
      shift_tasks: tareas(datos.empleado ?? 'esperado'),
      v_shift_peers: compas(),
      v_my_supervisions: filasSupervision(escenario),
      v_supervisor_today: turnosDeHoy(escenario, datos.usuarioId),
      v_my_workdays: jornadasPropias(escenario),
      rating_criteria: criteriosVigentes(),
      // Sin anuncios: en las fotos no tiene que aparecer ninguno de los de prueba de `App_dev`.
      v_my_announcements: [],
      profiles: [perfilDeEjemplo(datos, esSupervisor)],
      ratings: calificaciones(datos.supervisor),
      assignments: [
        { id: ID.asignacion1, employee_id: ID.empleadoA, shift_id: ID.turno1 },
        { id: ID.asignacion2, employee_id: ID.empleadoB, shift_id: ID.turno1 },
        { id: ID.asignacion3, employee_id: ID.empleadoC, shift_id: ID.turno1 },
        { id: ID.asignacion7, employee_id: ID.empleadoF, shift_id: ID.turno6 },
      ],
      v_people_basic: [
        {
          profile_id: ID.empleadoA,
          first_name: 'Ana',
          last_name: 'Ejemplo',
          avatar_path: null,
        },
        {
          profile_id: ID.empleadoB,
          first_name: 'Beto',
          last_name: 'Muestra',
          avatar_path: null,
        },
        {
          profile_id: ID.empleadoC,
          first_name: 'Carla',
          last_name: 'Demo',
          avatar_path: null,
        },
        {
          profile_id: ID.empleadoF,
          first_name: 'Fabián',
          last_name: 'Ficticio',
          avatar_path: null,
        },
      ],
    }
  }

  await contexto.route(/\/(rest|functions)\/v1\//, async (ruta) => {
    const pedido = ruta.request()
    const url = new URL(pedido.url())
    if (pedido.method() === 'OPTIONS') {
      await ruta.fallback()
      return
    }
    // Funciones `stable` (solo leen) que la app llama con POST para mostrar números: salen a la base.
    if (
      pedido.method() === 'POST' &&
      RPC_DE_SOLO_LECTURA.some((nombre) =>
        url.pathname.endsWith(`/rpc/${nombre}`),
      )
    ) {
      await ruta.fallback()
      return
    }
    if (pedido.method() !== 'GET' && pedido.method() !== 'HEAD') {
      ESCRITURAS_BLOQUEADAS.push(`${pedido.method()} ${url.pathname}`)
      await ruta.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '[]',
      })
      return
    }
    const tabla = url.pathname.split('/').pop() ?? ''
    // El perfil solo se reemplaza para la persona de la sesión (no para otras consultas).
    if (tabla === 'profiles' && !url.search.includes(datos.usuarioId)) {
      LECTURAS_REALES.add(`profiles${url.search.slice(0, 60)}`)
      await ruta.fallback()
      return
    }
    // Las preferencias dependen del cliente que abrió la captura: se arman en cada pedido.
    if (esAdmin && tabla === 'supervisor_priorities') {
      tablas[tabla] = prioridadesDeEjemplo(
        datos.coordinadorId ?? ID.coordinadorB,
      )
    }
    const filas = tablas[tabla]
    if (!filas) {
      LECTURAS_REALES.add(tabla)
      await ruta.fallback()
      return
    }
    const comoObjeto = (pedido.headers()['accept'] ?? '').includes(
      'application/vnd.pgrst.object+json',
    )
    await responder(ruta, aplicarFiltros(filas, url.searchParams), comoObjeto)
  })
}
