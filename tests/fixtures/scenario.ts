// tests/fixtures/scenario.ts — TEST-015/TEST-016 (P18.1)
//
// Armador de los datos POR CORRIDA de un test (clientes, sedes, servicios, turnos, asignaciones,
// supervisiones), con prefijo `e2e-` y fechas relativas a hoy en hora de Argentina. Cada test
// crea lo que necesita y lo limpia en `cleanup()`: no depende del orden ni del estado previo.
//
// Las cuentas (empleados, supervisores, administradores) NO se crean acá: son las cuentas fijas
// de `accounts.ts`. Los turnos van siempre recortados al día del turno (franjas fijas de
// `dates.ts`), nunca "ahora ± horas": el CI corre a cualquier hora.
//
// `service_role` no puede insertar en `assignments` ni llamar a las RPC de negocio (no hay
// `auth.uid()`): esas operaciones van con la sesión del dueño del seed, abierta una sola vez por
// proceso y renovada pasados 40 minutos.

import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  getAdminDb,
  loadAuthUserIds,
  type AdminDb,
  type FixedAccountKey,
} from './accounts.ts'
import { todayAR } from './dates.ts'
import { readId, signedClient, STATE_DIR, type SessionKey } from './sessions.ts'

export const E2E_PREFIX = 'e2e-'

/** Posición del celular que mandan las RPC de jornada y de supervisión (precisión en metros). */
export interface Posicion {
  latitude: number
  longitude: number
  accuracy: number
}

/** Plaza de Mayo (CABA): las sedes de prueba no tienen coordenadas, así que no se valida contra ellas. */
export const POSICION_DE_PRUEBA: Posicion = {
  latitude: -34.6083,
  longitude: -58.3712,
  accuracy: 12,
}

/**
 * Candado por coordinador (P24.5). La jornada es UNA por coordinador y por día (CJ-30) y una sola
 * supervisión puede estar abierta a la vez (CJ-08): dos tests que usen la misma cuenta fija al
 * mismo tiempo (los archivos de administración corren en dos procesos) se pisarían y el que
 * termina primero borraría la jornada del otro. El candado es una carpeta que se crea de forma
 * atómica dentro del estado de la corrida; se espera con sondeo (una espera por una condición
 * real, no un `sleep` fijo) y un candado de más de 20 minutos se considera abandonado.
 */
const ESPERA_CANDADO_MS = 5 * 60_000
const CANDADO_ABANDONADO_MS = 20 * 60_000

function carpetaCandado(who: FixedAccountKey): string {
  return path.join(STATE_DIR, `candado-${who}`)
}

async function tomarCandado(who: FixedAccountKey): Promise<void> {
  const carpeta = carpetaCandado(who)
  mkdirSync(STATE_DIR, { recursive: true })
  const limite = Date.now() + ESPERA_CANDADO_MS
  for (;;) {
    try {
      mkdirSync(carpeta)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    try {
      if (Date.now() - statSync(carpeta).mtimeMs > CANDADO_ABANDONADO_MS) {
        rmSync(carpeta, { recursive: true, force: true })
        continue
      }
    } catch {
      continue // lo soltaron justo ahora: se reintenta
    }
    if (Date.now() > limite) {
      throw new Error(
        `No se pudo reservar al coordinador ${who}: lo está usando otro test hace más de 5 minutos.`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

function soltarCandado(who: FixedAccountKey): void {
  rmSync(carpetaCandado(who), { recursive: true, force: true })
}

const EVENTOS_DE_JORNADA = ['start', 'pause', 'resume', 'end', 'reopen']

/**
 * Estado de la jornada de hoy del coordinador según su último evento vigente de jornada
 * (`running`, `paused` o `ended`); `null` si todavía no la inició. Lee con la clave de servicio.
 */
export async function estadoJornada(
  who: FixedAccountKey,
  db: AdminDb = getAdminDb(),
): Promise<'running' | 'paused' | 'ended' | null> {
  const { data: jornada } = await db
    .from('supervisor_workdays')
    .select('id')
    .eq('supervisor_id', readId(who))
    .eq('work_date', todayAR())
    .maybeSingle()
  if (!jornada) return null
  const { data: eventos } = await db
    .from('supervisor_workday_events')
    .select('kind')
    .eq('workday_id', jornada.id)
    .is('removed_at', null)
    .in('kind', EVENTOS_DE_JORNADA as never)
    .order('recorded_at', { ascending: false })
    .order('seq', { ascending: false })
    .limit(1)
  const ultimo = eventos?.[0]?.kind
  if (ultimo === 'pause') return 'paused'
  if (ultimo === 'end') return 'ended'
  return 'running'
}

/**
 * Borra las jornadas del coordinador (eventos y jornada) y suelta las supervisiones que cuelguen de
 * ellas. Es solo para limpiar datos de las pruebas (la app nunca borra, P-014). Con `desde` borra
 * desde esa fecha; sin ella, todas las del coordinador.
 */
export async function borrarJornadasDe(
  db: AdminDb,
  supervisorIds: string[],
  desde?: string,
): Promise<string[]> {
  const notes: string[] = []
  if (supervisorIds.length === 0) return notes
  let consulta = db
    .from('supervisor_workdays')
    .select('id')
    .in('supervisor_id', supervisorIds)
  if (desde) consulta = consulta.gte('work_date', desde)
  const { data: jornadas } = await consulta
  const ids = (jornadas ?? []).map((j) => j.id)
  if (ids.length === 0) return notes
  const soltar = await db
    .from('supervisions')
    .update({ workday_id: null })
    .in('workday_id', ids)
  if (soltar.error)
    notes.push(`supervisions.workday_id: ${soltar.error.message}`)
  const eventos = await db
    .from('supervisor_workday_events')
    .delete()
    .in('workday_id', ids)
  if (eventos.error)
    notes.push(`supervisor_workday_events: ${eventos.error.message}`)
  const borradas = await db.from('supervisor_workdays').delete().in('id', ids)
  if (borradas.error)
    notes.push(`supervisor_workdays: ${borradas.error.message}`)
  return notes
}

/** Nombre único y reconocible: `e2e-<slug>-<sufijo>`. */
export function uniqueName(slug: string): string {
  return `${E2E_PREFIX}${slug}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
}

/** CUIT de 11 dígitos único por corrida (la base solo exige formato numérico). */
export function uniqueCuit(): string {
  const tail = `${Date.now()}`.slice(-8) + Math.floor(Math.random() * 10)
  return `20${tail}`
}

interface CachedClient {
  client: AdminDb
  at: number
}
const clientCache = new Map<SessionKey, CachedClient>()
const MAX_AGE_MS = 40 * 60 * 1000

/** Cliente con sesión de la cuenta (cacheado por proceso). */
export async function sessionClient(key: SessionKey): Promise<AdminDb> {
  const hit = clientCache.get(key)
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.client
  const client = await signedClient(key)
  clientCache.set(key, { client, at: Date.now() })
  return client
}

export interface MadeClient {
  id: string
  name: string
}

export interface ServiceOptions {
  weekdays?: number[]
  start?: string
  end?: string
  staff?: number
  validFrom?: string
  validTo?: string | null
  worksOnHolidays?: boolean
  status?: 'active' | 'paused' | 'ended'
  /** Módulo H (H-07): el servicio pide fotos y sus turnos lo heredan. */
  requiresPhotos?: boolean
}

export interface SiteOptions {
  /** Módulo H (H-13): la sede no permite fotos ni videos. */
  photosNotAllowed?: boolean
}

export class Scenario {
  readonly db: AdminDb = getAdminDb()
  readonly today: string = todayAR()

  readonly clientIds: string[] = []
  readonly extraShiftIds: string[] = []
  readonly extraServiceIds: string[] = []
  readonly extraHolidayDates: string[] = []
  readonly farMonths: Array<{ year: number; month: number }> = []
  readonly leaveIds: string[] = []
  readonly availabilityIds: string[] = []
  /** Coordinadores cuya jornada de hoy armó este escenario (se borra al limpiar). */
  readonly coordinadores = new Set<FixedAccountKey>()
  /** Prioridades (`supervisor_priorities`) creadas por este escenario. */
  readonly prioridadIds: string[] = []

  /** Cliente activo con CUIT único. */
  async client(
    slug: string,
    status: 'active' | 'suspended' | 'closed' = 'active',
  ): Promise<MadeClient> {
    const name = uniqueName(slug)
    const { data, error } = await this.db
      .from('clients')
      .insert({
        legal_name: name,
        trade_name: name,
        cuit: uniqueCuit(),
        status,
      })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear el cliente: ${error.message}`)
    this.clientIds.push(data.id)
    return { id: data.id, name }
  }

  /** Sede activa; con `coords` queda ubicable en el mapa, sin ellas no (CB-20). */
  async site(
    clientId: string,
    slug: string,
    coords?: { lat: number; lng: number },
    options: SiteOptions = {},
  ): Promise<MadeClient> {
    const name = uniqueName(slug)
    const { data, error } = await this.db
      .from('sites')
      .insert({
        client_id: clientId,
        name,
        address: 'Dirección de prueba 123',
        status: 'active',
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        photos_not_allowed: options.photosNotAllowed ?? false,
      })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear la sede: ${error.message}`)
    return { id: data.id, name }
  }

  /** Servicio recurrente (por defecto, lunes a viernes de 08:00 a 12:00, vigente desde hoy). */
  async service(
    clientId: string,
    siteId: string,
    slug: string,
    options: ServiceOptions = {},
  ): Promise<MadeClient> {
    const name = uniqueName(slug)
    const { data, error } = await this.db
      .from('services')
      .insert({
        client_id: clientId,
        site_id: siteId,
        name,
        weekdays: options.weekdays ?? [1, 2, 3, 4, 5],
        start_time: options.start ?? '08:00',
        end_time: options.end ?? '12:00',
        required_staff: options.staff ?? 1,
        valid_from: options.validFrom ?? this.today,
        valid_to: options.validTo ?? null,
        works_on_holidays: options.worksOnHolidays ?? true,
        status: options.status ?? 'active',
        requires_photos: options.requiresPhotos ?? false,
      })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear el servicio: ${error.message}`)
    this.extraServiceIds.push(data.id)
    return { id: data.id, name }
  }

  /** Turno puntual insertado directo (franja fija, dotación `staff`). */
  async shift(
    clientId: string,
    siteId: string,
    date: string,
    franja: { start: string; end: string },
    staff = 1,
    options: { requiresPhotos?: boolean; serviceId?: string } = {},
  ): Promise<string> {
    const { data, error } = await this.db
      .from('shifts')
      .insert({
        client_id: clientId,
        site_id: siteId,
        shift_date: date,
        start_time: franja.start,
        end_time: franja.end,
        required_staff: staff,
        requires_photos: options.requiresPhotos ?? false,
        ...(options.serviceId ? { service_id: options.serviceId } : {}),
      })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear el turno: ${error.message}`)
    this.extraShiftIds.push(data.id)
    return data.id
  }

  /** Asigna una cuenta fija a un turno con la RPC real (`assign_employee`), como el dueño. */
  async assign(
    shiftId: string,
    who: FixedAccountKey,
    window?: { start: string; end: string },
  ): Promise<string> {
    const owner = await sessionClient('owner')
    const employeeId = readId(who)
    const { data, error } = await owner.rpc('assign_employee', {
      p_shift_id: shiftId,
      p_employee_id: employeeId,
      ...(window ? { p_start: window.start, p_end: window.end } : {}),
    })
    if (error) throw new Error(`No se pudo asignar a ${who}: ${error.message}`)
    return (data as unknown as { assignment: { id: string } }).assignment.id
  }

  /**
   * Reserva a un coordinador de las cuentas fijas para este escenario (candado entre procesos) y
   * lo anota para borrar sus jornadas al limpiar. Hay que llamarlo antes de tocar su jornada, su
   * supervisión abierta o sus consentimientos; `asegurarJornada`, `tomarSupervision` y
   * `jornadaPasada` ya lo hacen.
   */
  async tomarCoordinador(who: FixedAccountKey): Promise<void> {
    if (this.coordinadores.has(who)) return
    await tomarCandado(who)
    this.coordinadores.add(who)
  }

  /**
   * Deja la jornada de HOY del coordinador en marcha con las RPC reales y la sesión del propio
   * coordinador (P24, CJ-12, CJ-30): la inicia si no existe, la reanuda si está en pausa y la
   * reabre si estaba finalizada. Anota la cuenta para borrar sus jornadas al limpiar.
   */
  async asegurarJornada(
    who: FixedAccountKey,
    pos: Posicion = POSICION_DE_PRUEBA,
  ): Promise<void> {
    await this.tomarCoordinador(who)
    const client = await sessionClient(who)
    const estado = await estadoJornada(who)
    if (estado === 'running') return
    const args = {
      p_lat: pos.latitude,
      p_lng: pos.longitude,
      p_accuracy: pos.accuracy,
    }
    const llamada =
      estado === null
        ? await client.rpc('start_workday', args)
        : estado === 'paused'
          ? await client.rpc('resume_workday', args)
          : await client.rpc('reopen_workday', args)
    if (llamada.error) {
      throw new Error(
        `No se pudo dejar en marcha la jornada: ${llamada.error.message}`,
      )
    }
  }

  /**
   * El coordinador toma un turno de hoy con el flujo real (P24.1, CJ-26): deja la jornada en marcha
   * y llama a `take_supervision` con su sesión. Devuelve el id de la supervisión, que queda
   * `in_progress`. Reemplaza al viejo `assignSupervision`: ya no existe el estado «asignada».
   * El coordinador solo puede tener una supervisión abierta a la vez (CJ-08): cerrala antes de
   * tomar otro turno (`calificarYCerrar`), o usá `supervisionDirecta` para armar historial.
   */
  async tomarSupervision(
    shiftId: string,
    who: FixedAccountKey,
    pos: Posicion = POSICION_DE_PRUEBA,
  ): Promise<string> {
    await this.asegurarJornada(who, pos)
    const client = await sessionClient(who)
    const { data, error } = await client.rpc('take_supervision', {
      p_shift_id: shiftId,
      p_lat: pos.latitude,
      p_lng: pos.longitude,
      p_accuracy: pos.accuracy,
    })
    if (error) {
      throw new Error(`No se pudo tomar la supervisión: ${error.message}`)
    }
    const payload = data as unknown as { supervision: { id: string } }
    return payload.supervision.id
  }

  /**
   * Jornada de un día anterior (o de hoy) registrada en nombre del coordinador con la RPC real
   * `admin_record_workday`, como el dueño (CJ-32). `desde` y `hasta` son `HH:MM` de Argentina. La
   * jornada queda marcada como corregida. Devuelve el id de la jornada.
   */
  async jornadaPasada(
    who: FixedAccountKey,
    fecha: string,
    desde: string,
    hasta: string,
    motivo = `${E2E_PREFIX}jornada registrada`,
  ): Promise<string> {
    await this.tomarCoordinador(who)
    const owner = await sessionClient('owner')
    const { data, error } = await owner.rpc('admin_record_workday', {
      p_supervisor_id: readId(who),
      p_work_date: fecha,
      p_started_at: `${fecha}T${desde}:00-03:00`,
      p_reason: motivo,
      p_ended_at: `${fecha}T${hasta}:00-03:00`,
    })
    if (error) {
      throw new Error(`No se pudo registrar la jornada: ${error.message}`)
    }
    return (data as unknown as { workday_id: string }).workday_id
  }

  /**
   * Jornada armada directo con la clave de servicio, para los estados que la app no deja armar a
   * propósito: cerrada sola a las 23:55 (CJ-31, `autoCerrada`) con o sin una supervisión que queda
   * «Sin cerrar», o con pausas cargadas. Imita lo que dejan las RPC: evento `start`, pausas
   * (`pause` y `resume`), eventos de la supervisión y evento `end`. `hasta` es `HH:MM` de Argentina;
   * sin él la jornada queda abierta. Devuelve los ids de la jornada y, si hay, de la supervisión.
   */
  async jornadaDirecta(
    who: FixedAccountKey,
    fecha: string,
    pedido: {
      desde: string
      hasta?: string
      autoCerrada?: boolean
      pausas?: Array<{ desde: string; hasta: string; motivo?: string }>
      /** Turno de esa fecha con una supervisión que la jornada cierra sola («Sin cerrar»). */
      turnoSinCerrar?: { shiftId: string; desde: string }
    },
  ): Promise<{ workdayId: string; supervisionId: string | null }> {
    await this.tomarCoordinador(who)
    const hora = (hhmm: string) => `${fecha}T${hhmm}:00-03:00`
    const { data: jornada, error } = await this.db
      .from('supervisor_workdays')
      .insert({
        supervisor_id: readId(who),
        work_date: fecha,
        started_at: hora(pedido.desde),
        ended_at: pedido.hasta ? hora(pedido.hasta) : null,
        auto_closed: pedido.autoCerrada ?? false,
      })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear la jornada: ${error.message}`)
    const evento = async (
      kind:
        | 'start'
        | 'pause'
        | 'resume'
        | 'end'
        | 'supervision_start'
        | 'supervision_end',
      hhmm: string,
      extra: { reason?: string; supervision_id?: string } = {},
    ) => {
      const { error: errorEvento } = await this.db
        .from('supervisor_workday_events')
        .insert({
          workday_id: jornada.id,
          kind,
          recorded_at: hora(hhmm),
          reason: extra.reason ?? null,
          supervision_id: extra.supervision_id ?? null,
        })
      if (errorEvento) {
        throw new Error(
          `No se pudo crear el evento ${kind}: ${errorEvento.message}`,
        )
      }
    }
    await evento('start', pedido.desde)
    for (const pausa of pedido.pausas ?? []) {
      await evento('pause', pausa.desde, { reason: pausa.motivo })
      await evento('resume', pausa.hasta)
    }
    let supervisionId: string | null = null
    if (pedido.turnoSinCerrar && pedido.hasta) {
      supervisionId = await this.supervisionDirecta(
        pedido.turnoSinCerrar.shiftId,
        who,
        {
          estado: 'en_curso',
          inicio: hora(pedido.turnoSinCerrar.desde),
          fin: hora(pedido.hasta),
          jornadaId: jornada.id,
        },
      )
      await evento('supervision_start', pedido.turnoSinCerrar.desde, {
        supervision_id: supervisionId,
      })
      await evento('supervision_end', pedido.hasta, {
        supervision_id: supervisionId,
      })
    }
    if (pedido.hasta) {
      await evento('end', pedido.hasta, {
        reason: pedido.autoCerrada ? 'Cierre automático' : undefined,
      })
    }
    return { workdayId: jornada.id, supervisionId }
  }

  /**
   * Supervisión armada directo con la clave de servicio (sin jornada), para el historial de otros
   * días, estados cerrados y escenarios que no pasan por el flujo del celular. `en_curso` queda
   * `in_progress` con el inicio registrado; `completada` suma el fin; `cancelada` lleva motivo.
   * Nunca la ve `open_supervision_id` (no tiene `workday_id`), así que no bloquea la jornada.
   */
  async supervisionDirecta(
    shiftId: string,
    who: FixedAccountKey,
    options: {
      estado?: 'en_curso' | 'completada' | 'cancelada' | 'no_realizada'
      inicio?: string
      fin?: string
      notas?: string
      /** Jornada a la que cuelga (por ejemplo, la de un día anterior armada con `jornadaPasada`). */
      jornadaId?: string
    } = {},
  ): Promise<string> {
    const estado = options.estado ?? 'completada'
    const { data: criterios } = await this.db
      .from('rating_criteria')
      .select('id, title, description, position')
      .order('position')
    const { data, error } = await this.db
      .from('supervisions')
      .insert({
        shift_id: shiftId,
        supervisor_id: readId(who),
        // `no_realizada` (`not_done`) ya no se usa en la app (CJ-26) pero queda en el historial.
        status:
          estado === 'en_curso'
            ? 'in_progress'
            : estado === 'completada'
              ? 'completed'
              : estado === 'no_realizada'
                ? 'not_done'
                : 'cancelled',
        cancel_reason: estado === 'cancelada' ? `${E2E_PREFIX}cancelada` : null,
        not_done_reason:
          estado === 'no_realizada' ? `${E2E_PREFIX}no realizada` : null,
        general_notes: options.notas ?? null,
        workday_id: options.jornadaId ?? null,
        criteria_snapshot: criterios ?? [],
      })
      .select('id')
      .single()
    if (error) {
      throw new Error(`No se pudo crear la supervisión: ${error.message}`)
    }
    const marcas: Array<{ kind: 'check_in' | 'check_out'; at: string }> = []
    if (estado === 'en_curso' || estado === 'completada') {
      marcas.push({
        kind: 'check_in',
        at: options.inicio ?? new Date(Date.now() - 30 * 60_000).toISOString(),
      })
    }
    if (estado === 'completada' || (estado === 'en_curso' && options.fin)) {
      marcas.push({
        kind: 'check_out',
        at: options.fin ?? new Date(Date.now() - 5 * 60_000).toISOString(),
      })
    }
    if (marcas.length > 0) {
      const { error: marcaError } = await this.db
        .from('supervision_attendance')
        .insert(
          marcas.map((m) => ({
            supervision_id: data.id,
            kind: m.kind,
            recorded_at: m.at,
          })),
        )
      if (marcaError) {
        throw new Error(
          `No se pudo registrar la asistencia: ${marcaError.message}`,
        )
      }
    }
    return data.id
  }

  /**
   * Prioridad (sede o cliente preferencial) de un coordinador con la RPC real
   * (`set_supervisor_priority`), como el dueño. Se borra al limpiar. Devuelve el id.
   */
  async prioridad(
    who: FixedAccountKey,
    objetivo: { clientId: string } | { siteId: string },
  ): Promise<string> {
    const owner = await sessionClient('owner')
    const { data, error } = await owner.rpc('set_supervisor_priority', {
      p_supervisor_id: readId(who),
      ...('clientId' in objetivo
        ? { p_client_id: objetivo.clientId }
        : { p_site_id: objetivo.siteId }),
    })
    if (error) {
      throw new Error(`No se pudo cargar la prioridad: ${error.message}`)
    }
    const id = (data as unknown as { id: string }).id
    this.prioridadIds.push(id)
    return id
  }

  /**
   * Reserva un mes lejano para una prueba de generación (`generate_shifts` es global: crea los
   * turnos de TODOS los servicios activos vigentes, también los del seed). Al limpiar se borran
   * los turnos de ese mes que no tengan asignaciones. Cada archivo de prueba reserva un mes
   * distinto para no pisarse con otro en paralelo.
   */
  useFarMonth(year: number, month: number): void {
    this.farMonths.push({ year, month })
  }

  /** Licencia de una cuenta fija entre dos fechas (inclusive); se borra al limpiar. */
  async leave(who: FixedAccountKey, from: string, to: string): Promise<void> {
    const { data, error } = await this.db
      .from('employee_leaves')
      .insert({
        employee_id: readId(who),
        starts_on: from,
        ends_on: to,
        reason: `${E2E_PREFIX}licencia`,
      })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear la licencia: ${error.message}`)
    this.leaveIds.push(data.id)
  }

  /** Disponibilidad semanal de una cuenta fija (día 0 = domingo); se borra al limpiar. */
  async availability(
    who: FixedAccountKey,
    weekday: number,
    start: string,
    end: string,
  ): Promise<void> {
    const { data, error } = await this.db
      .from('employee_availability')
      .insert({
        employee_id: readId(who),
        weekday,
        start_time: start,
        end_time: end,
      })
      .select('id')
      .single()
    if (error) {
      throw new Error(`No se pudo crear la disponibilidad: ${error.message}`)
    }
    this.availabilityIds.push(data.id)
  }

  /** Habilita a una cuenta fija para un cliente (`employee_client_permissions`). */
  async enableForClient(who: FixedAccountKey, clientId: string): Promise<void> {
    const { error } = await this.db
      .from('employee_client_permissions')
      .insert({ employee_id: readId(who), client_id: clientId })
    if (error) throw new Error(`No se pudo habilitar: ${error.message}`)
  }

  /** Feriado propio de la prueba (la fecha es única en toda la tabla): se da de baja al limpiar. */
  async holiday(date: string, name: string): Promise<void> {
    const { data: existing } = await this.db
      .from('holidays')
      .select('id, deleted_at')
      .eq('holiday_date', date)
      .maybeSingle()
    if (existing) {
      // Residuo de una corrida cortada a la mitad: solo se pisa si es de esta suite.
      const { data: row } = await this.db
        .from('holidays')
        .select('name')
        .eq('holiday_date', date)
        .single()
      if (!row?.name?.startsWith(E2E_PREFIX)) {
        throw new Error(
          `Ya existe un feriado el ${date} que no es de esta suite; elegí otra fecha para el test.`,
        )
      }
      await this.db.from('holidays').delete().eq('holiday_date', date)
    }
    const { error } = await this.db
      .from('holidays')
      .insert({ holiday_date: date, name })
    if (error) throw new Error(`No se pudo crear el feriado: ${error.message}`)
    this.extraHolidayDates.push(date)
  }

  /**
   * Limpieza. Borra todo lo que cuelga de los clientes del test (hijos antes que padres); lo que
   * la base no deje borrar queda con baja lógica. Los fallos no rompen el test: se devuelven
   * como notas para que se puedan informar.
   */
  async cleanup(): Promise<string[]> {
    const notes: string[] = []
    if (this.prioridadIds.length > 0) {
      const { error } = await this.db
        .from('supervisor_priorities')
        .delete()
        .in('id', this.prioridadIds)
      if (error) notes.push(`supervisor_priorities: ${error.message}`)
    }
    for (const clientId of this.clientIds) {
      notes.push(...(await deleteClientDeep(this.db, clientId)))
    }
    if (this.coordinadores.size > 0) {
      notes.push(
        ...(await borrarJornadasDe(
          this.db,
          Array.from(this.coordinadores, (who) => readId(who)),
        )),
      )
      for (const who of this.coordinadores) soltarCandado(who)
      this.coordinadores.clear()
    }
    for (const { year, month } of this.farMonths) {
      notes.push(...(await purgeMonth(this.db, year, month)))
    }
    if (this.leaveIds.length > 0) {
      const { error } = await this.db
        .from('employee_leaves')
        .delete()
        .in('id', this.leaveIds)
      if (error) notes.push(`licencias: ${error.message}`)
    }
    if (this.availabilityIds.length > 0) {
      const { error } = await this.db
        .from('employee_availability')
        .delete()
        .in('id', this.availabilityIds)
      if (error) notes.push(`disponibilidad: ${error.message}`)
    }
    if (this.extraHolidayDates.length > 0) {
      const { error } = await this.db
        .from('holidays')
        .delete()
        .in('holiday_date', this.extraHolidayDates)
      if (error) {
        await this.db
          .from('holidays')
          .update({ deleted_at: new Date().toISOString() })
          .in('holiday_date', this.extraHolidayDates)
        notes.push(
          `feriados dados de baja (no se pudieron borrar): ${error.message}`,
        )
      }
    }
    return notes
  }
}

type Failure = { message: string } | null

/**
 * Borra un cliente y TODO lo que cuelga de él (supervisiones y calificaciones, asistencia,
 * asignaciones, tareas, evidencia de los turnos, turnos, servicios, plantillas, contactos, habilitaciones, sedes). Si la
 * base no deja borrar el cliente o sus sedes, los deja con baja lógica.
 */
export async function deleteClientDeep(
  db: AdminDb,
  clientId: string,
): Promise<string[]> {
  const notes: string[] = []
  const note = (what: string, error: Failure) => {
    if (error) notes.push(`${what}: ${error.message}`)
  }

  const { data: shifts } = await db
    .from('shifts')
    .select('id')
    .eq('client_id', clientId)
  const shiftIds = (shifts ?? []).map((s) => s.id)

  if (shiftIds.length > 0) {
    // Módulo H: la evidencia cuelga del turno (y de asignaciones y supervisiones). Primero los
    // objetos del bucket `evidence` y después las filas de `shift_media`.
    notes.push(...(await deleteShiftMedia(db, shiftIds)))

    const { data: sups } = await db
      .from('supervisions')
      .select('id')
      .in('shift_id', shiftIds)
    const supIds = (sups ?? []).map((s) => s.id)
    if (supIds.length > 0) {
      // P24.1: los eventos de jornada de cada supervisión cuelgan de ella.
      note(
        'supervisor_workday_events',
        (
          await db
            .from('supervisor_workday_events')
            .delete()
            .in('supervision_id', supIds)
        ).error,
      )
      note(
        'ratings',
        (await db.from('ratings').delete().in('supervision_id', supIds)).error,
      )
      note(
        'supervision_attendance',
        (
          await db
            .from('supervision_attendance')
            .delete()
            .in('supervision_id', supIds)
        ).error,
      )
      note(
        'supervisions',
        (await db.from('supervisions').delete().in('id', supIds)).error,
      )
    }

    const { data: asg } = await db
      .from('assignments')
      .select('id')
      .in('shift_id', shiftIds)
    const asgIds = (asg ?? []).map((a) => a.id)
    if (asgIds.length > 0) {
      note(
        'attendance_notices',
        (
          await db
            .from('attendance_notices')
            .delete()
            .in('assignment_id', asgIds)
        ).error,
      )
      // Módulo B1: las correcciones de hora y de validación cuelgan del fichaje (B-41).
      const { data: fichajes } = await db
        .from('attendance_records')
        .select('id')
        .in('assignment_id', asgIds)
      const fichajeIds = (fichajes ?? []).map((f) => f.id)
      if (fichajeIds.length > 0) {
        note(
          'attendance_corrections',
          (
            await db
              .from('attendance_corrections')
              .delete()
              .in('attendance_record_id', fichajeIds)
          ).error,
        )
      }
      note(
        'attendance_records',
        (
          await db
            .from('attendance_records')
            .delete()
            .in('assignment_id', asgIds)
        ).error,
      )
      note(
        'assignments',
        (await db.from('assignments').delete().in('id', asgIds)).error,
      )
    }
    note(
      'shift_observations',
      (await db.from('shift_observations').delete().in('shift_id', shiftIds))
        .error,
    )
    note(
      'shift_tasks',
      (await db.from('shift_tasks').delete().in('shift_id', shiftIds)).error,
    )
    note('shifts', (await db.from('shifts').delete().in('id', shiftIds)).error)
  }

  note(
    'services',
    (await db.from('services').delete().eq('client_id', clientId)).error,
  )

  const { data: sites } = await db
    .from('sites')
    .select('id')
    .eq('client_id', clientId)
  const siteIds = (sites ?? []).map((s) => s.id)

  const { data: templates } = await db
    .from('checklist_templates')
    .select('id')
    .eq('client_id', clientId)
  const templateIds = (templates ?? []).map((t) => t.id)
  if (templateIds.length > 0) {
    note(
      'checklist_template_items',
      (
        await db
          .from('checklist_template_items')
          .delete()
          .in('template_id', templateIds)
      ).error,
    )
    note(
      'checklist_templates',
      (await db.from('checklist_templates').delete().in('id', templateIds))
        .error,
    )
  }

  // P24.1: las prioridades de coordinadores cuelgan del cliente o de sus sedes.
  note(
    'supervisor_priorities (cliente)',
    (await db.from('supervisor_priorities').delete().eq('client_id', clientId))
      .error,
  )
  if (siteIds.length > 0) {
    note(
      'supervisor_priorities (sedes)',
      (await db.from('supervisor_priorities').delete().in('site_id', siteIds))
        .error,
    )
  }
  note(
    'client_contacts',
    (await db.from('client_contacts').delete().eq('client_id', clientId)).error,
  )
  note(
    'employee_client_permissions',
    (
      await db
        .from('employee_client_permissions')
        .delete()
        .eq('client_id', clientId)
    ).error,
  )

  const now = new Date().toISOString()
  if (siteIds.length > 0) {
    const { error } = await db.from('sites').delete().in('id', siteIds)
    if (error) {
      note(
        'baja lógica de sedes',
        (
          await db
            .from('sites')
            .update({ status: 'inactive', deleted_at: now })
            .in('id', siteIds)
        ).error,
      )
    }
  }
  const { error: clientError } = await db
    .from('clients')
    .delete()
    .eq('id', clientId)
  if (clientError) {
    note(
      'baja lógica del cliente',
      (
        await db
          .from('clients')
          .update({ status: 'closed', deleted_at: now })
          .eq('id', clientId)
      ).error,
    )
  }
  return notes
}

/**
 * Módulo H: borra la evidencia de unos turnos. Saca del bucket `evidence` los archivos de cada fila
 * (también los de las filas pendientes o quitadas) y todo lo que haya bajo la carpeta del turno
 * (por si una subida quedó sin fila), y después borra las filas de `shift_media`. Es solo para
 * limpiar datos propios de las pruebas: la app nunca borra filas (P-014).
 */
export async function deleteShiftMedia(
  db: AdminDb,
  shiftIds: string[],
): Promise<string[]> {
  const notes: string[] = []
  if (shiftIds.length === 0) return notes

  const paths = new Set<string>()
  const { data: rows, error: rowsError } = await db
    .from('shift_media')
    .select('storage_path, thumb_path')
    .in('shift_id', shiftIds)
  if (rowsError) notes.push(`shift_media (lectura): ${rowsError.message}`)
  for (const row of rows ?? []) {
    paths.add(row.storage_path)
    paths.add(row.thumb_path)
  }
  for (const shiftId of shiftIds) {
    const { data: listed } = await db.storage
      .from('evidence')
      .list(shiftId, { limit: 1000 })
    for (const obj of listed ?? []) paths.add(`${shiftId}/${obj.name}`)
  }
  const all = Array.from(paths)
  for (let i = 0; i < all.length; i += 100) {
    const { error } = await db.storage
      .from('evidence')
      .remove(all.slice(i, i + 100))
    if (error) notes.push(`objetos de evidence: ${error.message}`)
  }
  const { error } = await db
    .from('shift_media')
    .delete()
    .in('shift_id', shiftIds)
  if (error) notes.push(`shift_media: ${error.message}`)
  return notes
}

/** Borra los turnos sin asignaciones de un mes (y sus tareas): residuo de `generate_shifts`. */
export async function purgeMonth(
  db: AdminDb,
  year: number,
  month: number,
): Promise<string[]> {
  const notes: string[] = []
  const mm = String(month).padStart(2, '0')
  const { data: shifts } = await db
    .from('shifts')
    .select('id')
    .gte('shift_date', `${year}-${mm}-01`)
    .lte('shift_date', `${year}-${mm}-31`)
  const ids = (shifts ?? []).map((s) => s.id)
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data: used } = await db
      .from('assignments')
      .select('shift_id')
      .in('shift_id', chunk)
    const usedIds = new Set((used ?? []).map((a) => a.shift_id))
    const free = chunk.filter((id) => !usedIds.has(id))
    if (free.length === 0) continue
    const tasks = await db.from('shift_tasks').delete().in('shift_id', free)
    if (tasks.error)
      notes.push(`shift_tasks ${year}-${mm}: ${tasks.error.message}`)
    const del = await db.from('shifts').delete().in('id', free)
    if (del.error) notes.push(`shifts ${year}-${mm}: ${del.error.message}`)
  }
  return notes
}

/**
 * Barrido de residuos de corridas anteriores que se cortaron a la mitad: borra los clientes cuyo
 * nombre empieza con el prefijo `e2e-` (los de TEST-016 y siguientes) con todo lo que cuelga.
 * Los clientes de las suites viejas llevan otros prefijos (`E2E-P…`) y no se tocan.
 */
export async function sweepResidues(
  db: AdminDb = getAdminDb(),
): Promise<number> {
  const { data } = await db
    .from('clients')
    .select('id')
    .like('legal_name', `${E2E_PREFIX}%`)
  let swept = 0
  for (const row of data ?? []) {
    await deleteClientDeep(db, row.id)
    swept += 1
  }
  // P24.1: las jornadas y prioridades de los coordinadores de prueba (cuentas `e2e-fijo-*` de
  // todos los conjuntos) son datos de las pruebas: una corrida cortada puede dejar la de hoy.
  const fijas = [...(await loadAuthUserIds(db))]
    .filter(([email]) => email.startsWith('e2e-fijo-'))
    .map(([, id]) => id)
  await borrarJornadasDe(db, fijas)
  if (fijas.length > 0) {
    await db.from('supervisor_priorities').delete().in('supervisor_id', fijas)
  }
  return swept
}
