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
import { getAdminDb, type AdminDb, type FixedAccountKey } from './accounts.ts'
import { todayAR } from './dates.ts'
import { readId, signedClient, type SessionKey } from './sessions.ts'

export const E2E_PREFIX = 'e2e-'

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
        notes: `${E2E_PREFIX}turno de prueba`,
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

  /** Asigna una supervisión de una cuenta fija a un turno (`assign_supervision`), como el dueño. */
  async assignSupervision(
    shiftId: string,
    who: FixedAccountKey,
  ): Promise<string> {
    const owner = await sessionClient('owner')
    const supervisorId = readId(who)
    const { data, error } = await owner.rpc('assign_supervision', {
      p_shift_id: shiftId,
      p_supervisor_id: supervisorId,
    })
    if (error) {
      throw new Error(`No se pudo asignar la supervisión: ${error.message}`)
    }
    const payload = data as unknown as { supervision: { id: string } }
    return payload.supervision.id
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
    for (const clientId of this.clientIds) {
      notes.push(...(await deleteClientDeep(this.db, clientId)))
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
 * asignaciones, tareas, turnos, servicios, plantillas, contactos, habilitaciones, sedes). Si la
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
    const { data: sups } = await db
      .from('supervisions')
      .select('id')
      .in('shift_id', shiftIds)
    const supIds = (sups ?? []).map((s) => s.id)
    if (supIds.length > 0) {
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
  return swept
}
