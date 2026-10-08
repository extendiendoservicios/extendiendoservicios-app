// docs/guias/datos-ejemplo.ts — DOC-019, DOC-020 (P19.4)
//
// Datos de ejemplo para las capturas de la app del empleado y del supervisor. Las cuentas fijas
// de prueba (`e2e-fijo-*`) no tienen turnos ni supervisiones, y para tener pantallas con contenido
// no se puede crear nada en `App_dev` (las capturas son de solo lectura). Entonces las respuestas
// de lectura del navegador (`/rest/v1/v_my_day`, `v_my_supervisions`, etc.) se reemplazan, dentro
// del propio navegador de la captura, por los datos ficticios de este archivo. No se toca la base.
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

export type EscenarioSupervisor =
  'asignada' | 'en-curso' | 'por-cerrar' | 'completada' | 'sin-supervisiones'

export interface DatosDeEjemplo {
  /** Identificador de la sesión que se está usando (el `sub` del token). */
  usuarioId: string
  /** Si la persona ya dio su consentimiento de ubicación. */
  consentimiento: boolean
  empleado?: EscenarioEmpleado
  supervisor?: EscenarioSupervisor
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

function filasSupervision(
  escenario: EscenarioSupervisor,
): Record<string, unknown>[] {
  const criterios = [
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
  const asignados = (conInicio: boolean) => [
    {
      employee_id: ID.empleadoA,
      first_name: 'Ana',
      last_name: 'Ejemplo',
      status: conInicio ? 'present' : 'expected',
      check_in_at: conInicio ? instante(130) : null,
    },
    {
      employee_id: ID.empleadoB,
      first_name: 'Beto',
      last_name: 'Muestra',
      status: conInicio ? 'present' : 'expected',
      check_in_at: conInicio ? instante(125) : null,
    },
    {
      employee_id: ID.empleadoC,
      first_name: 'Carla',
      last_name: 'Demo',
      status: conInicio ? 'absence_notified' : 'expected',
      check_in_at: null,
    },
  ]
  const base = {
    shift_id: ID.turno1,
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
    start_time: FRANJA_1.inicio,
    end_time: FRANJA_1.fin,
    starts_at: null,
    ends_at: null,
    assigned_at: instante(1500),
    not_done_reason: null,
    cancel_reason: null,
    general_notes: null,
    criteria_snapshot: null,
    check_in_at: null,
    check_out_at: null,
  }
  const hoy = fechaLocal(0)
  const actual: Record<string, unknown> = {
    ...base,
    id: ID.supervision1,
    shift_date: hoy,
    status: 'assigned',
    assigned_employees: asignados(false),
  }
  if (escenario === 'en-curso' || escenario === 'por-cerrar') {
    actual.status = 'in_progress'
    actual.check_in_at = instante(140)
    actual.criteria_snapshot = criterios
    actual.assigned_employees = asignados(true)
  }
  if (escenario === 'por-cerrar') {
    actual.check_out_at = instante(10)
  }
  if (escenario === 'completada') {
    actual.status = 'completed'
    actual.check_in_at = instante(300)
    actual.check_out_at = instante(60)
    actual.criteria_snapshot = criterios
    actual.assigned_employees = asignados(true)
  }
  const proxima: Record<string, unknown> = {
    ...base,
    id: ID.supervision2,
    shift_id: ID.turno2,
    shift_date: fechaLocal(1),
    client_id: ID.cliente2,
    client_legal_name: 'Oficinas Muestra S.R.L.',
    site_id: ID.sede2,
    site_name: 'Sede Norte',
    site_address: 'Calle de Muestra 456',
    start_time: '14:00:00',
    end_time: '18:00:00',
    status: 'assigned',
    assigned_employees: asignados(false).slice(0, 2),
  }
  const cerrada: Record<string, unknown> = {
    ...base,
    id: ID.supervision3,
    shift_id: ID.turno3,
    shift_date: fechaLocal(-3),
    status: 'completed',
    check_in_at: instante(60 * 24 * 3 + 200),
    check_out_at: instante(60 * 24 * 3 + 20),
    criteria_snapshot: criterios,
    assigned_employees: asignados(true).slice(0, 2),
  }
  if (escenario === 'sin-supervisiones') return []
  if (escenario === 'completada') return [actual, cerrada]
  return [actual, proxima, cerrada]
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
  if (escenario !== 'completada') return []
  const fila = (
    supervision: string,
    asignacion: string,
    puntaje: number,
    n: number,
  ) => ({
    id: `99999999-9999-4999-8999-00000000000${n}`,
    supervision_id: supervision,
    assignment_id: asignacion,
    score: puntaje,
    comment: null,
    created_at: instante(60),
    created_by: null,
    updated_at: null,
    updated_by: null,
  })
  return [
    fila(ID.supervision1, ID.asignacion1, 5, 1),
    fila(ID.supervision1, ID.asignacion2, 4, 2),
    fila(ID.supervision1, ID.asignacion3, 4, 3),
    fila(ID.supervision3, ID.asignacion1, 5, 4),
    fila(ID.supervision3, ID.asignacion2, 3, 5),
  ]
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

/** Pedidos de lectura que no se reemplazaron y salieron a la base real (para revisar). */
export const LECTURAS_REALES = new Set<string>()
/** Pedidos de escritura que se bloquearon (tiene que quedar en cero si no se hizo clic en nada). */
export const ESCRITURAS_BLOQUEADAS: string[] = []

export async function instalarDatosDeEjemplo(
  contexto: BrowserContext,
  datos: DatosDeEjemplo,
): Promise<void> {
  ahora = ahoraDeLasCapturas()
  await contexto.clock.setFixedTime(ahora)
  const esSupervisor = datos.supervisor !== undefined
  const miDia = filaMiDia(datos.empleado ?? 'esperado', datos.usuarioId)
  const supervisiones = filasSupervision(
    datos.supervisor ?? 'sin-supervisiones',
  )
  const tablas: Record<string, Record<string, unknown>[]> = {
    v_my_day: miDia,
    shift_tasks: tareas(datos.empleado ?? 'esperado'),
    v_shift_peers: compas(),
    v_my_supervisions: supervisiones,
    rating_criteria: criteriosVigentes(),
    profiles: [perfilDeEjemplo(datos, esSupervisor)],
    ratings: calificaciones(datos.supervisor),
    assignments: [
      { id: ID.asignacion1, employee_id: ID.empleadoA, shift_id: ID.turno1 },
      { id: ID.asignacion2, employee_id: ID.empleadoB, shift_id: ID.turno1 },
      { id: ID.asignacion3, employee_id: ID.empleadoC, shift_id: ID.turno1 },
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
    ],
  }

  await contexto.route(/\/(rest|functions)\/v1\//, async (ruta) => {
    const pedido = ruta.request()
    const url = new URL(pedido.url())
    if (pedido.method() === 'OPTIONS') {
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
