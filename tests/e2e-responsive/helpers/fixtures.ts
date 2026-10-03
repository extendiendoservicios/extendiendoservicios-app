// tests/e2e-responsive/helpers/fixtures.ts — RESP-003 a RESP-007 (P17.2)
//
// Datos de prueba de la revisión responsive, con prefijo `E2E-P172`, creados y borrados por la
// propia suite (nunca uuids escritos a mano).
//
// Anclaje de las fechas y las horas (regla del encargo, "el CI corre a cualquier hora"):
//  - Todos los turnos se arman relativos a "hoy" en hora de Argentina, calculado UNA vez.
//  - Nada depende de la hora a la que se corre: los turnos "de hoy" cubren el día entero
//    (00:00–23:59), así siempre están vigentes y la asignación del empleado siempre es "la de
//    hoy". Cerca de la medianoche de Argentina el "hoy" cambia durante la corrida: ahí los
//    specs se saltean con un motivo explícito (`isTooCloseToMidnight`).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types.ts'
import { SEED_ACCOUNTS } from '../../permissions/fixtures/seed-accounts.ts'
import { readE2eResponsiveEnv } from './env.ts'

export type AdminClient = SupabaseClient<Database>

export const E2E_PREFIX = 'E2E-P172'

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires'

/** Fecha de hoy en Argentina como `YYYY-MM-DD`. */
export function argentinaTodayISODate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ARGENTINA_TZ }).format(
    new Date(),
  )
}

/** Suma `days` días a una fecha `YYYY-MM-DD` (sin zona horaria: aritmética de calendario). */
export function addDaysISO(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

/** Minutos transcurridos desde las 0:00 de Argentina. */
export function argentinaMinutesSinceMidnight(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ARGENTINA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const hours = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minutes = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hours * 60 + minutes
}

/** Seis minutos antes y cuatro después de la medianoche de Argentina el "hoy" no es estable. */
export function isTooCloseToMidnight(): boolean {
  const since = argentinaMinutesSinceMidnight()
  return since < 4 || since > 24 * 60 - 6
}

export const NEAR_MIDNIGHT_MESSAGE =
  'Estamos a menos de 6 minutos de la medianoche de Argentina (o recién pasada): el "hoy" ' +
  'cambia durante la corrida. Se saltea explícito -- reintentar unos minutos más tarde.'

let cachedAdmin: AdminClient | null = null

export function getAdminClient(): AdminClient {
  if (cachedAdmin) return cachedAdmin
  const env = readE2eResponsiveEnv()
  if (!env) throw new Error('getAdminClient() llamado sin .env.local completo.')
  cachedAdmin = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedAdmin
}

let counter = 0
function uniqueSuffix(): string {
  counter += 1
  return `${Date.now()}-${counter}`
}

export interface DisposableUser {
  profileId: string
  email: string
  password: string
  firstName: string
  lastName: string
}

/**
 * Armador de datos: registra todo lo que crea y lo borra en `cleanup()`. `service_role` no puede
 * insertar en `assignments` ni llamar a las RPC de negocio (no hay `auth.uid()`): esas
 * operaciones van con una sesión del dueño del seed, abierta una sola vez.
 */
export class ResponsiveScenario {
  readonly admin = getAdminClient()
  readonly today = argentinaTodayISODate()

  private ownerClient: AdminClient | null = null
  private readonly clientIds: string[] = []
  private readonly siteIds: string[] = []
  private readonly serviceIds: string[] = []
  private readonly shiftIds: string[] = []
  private readonly assignmentIds: string[] = []
  private readonly supervisionIds: string[] = []
  private readonly profileIds: string[] = []

  async owner(): Promise<AdminClient> {
    if (this.ownerClient) return this.ownerClient
    const env = readE2eResponsiveEnv()!
    const owner = createClient<Database>(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await owner.auth.signInWithPassword({
      email: SEED_ACCOUNTS.owner,
      password: env.seedPassword,
    })
    if (error) {
      throw new Error(
        `No se pudo iniciar sesión como el dueño del seed: ${error.message}`,
      )
    }
    this.ownerClient = owner
    return owner
  }

  async createClient(slug: string): Promise<{ id: string; name: string }> {
    const name = `${E2E_PREFIX} ${slug} ${uniqueSuffix()}`
    const digits = `${Date.now()}`.slice(-8) + Math.floor(Math.random() * 10)
    const { data, error } = await this.admin
      .from('clients')
      .insert({
        legal_name: name,
        trade_name: name,
        cuit: `20${digits}`,
        status: 'active',
      })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear el cliente: ${error.message}`)
    this.clientIds.push(data.id)
    return { id: data.id, name }
  }

  async createSite(
    clientId: string,
    slug: string,
  ): Promise<{ id: string; name: string }> {
    const name = `${E2E_PREFIX} ${slug} ${uniqueSuffix()}`
    const { data, error } = await this.admin
      .from('sites')
      .insert({
        client_id: clientId,
        name,
        address: 'Dirección de prueba, sin importancia',
        status: 'active',
      })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear la sede: ${error.message}`)
    this.siteIds.push(data.id)
    return { id: data.id, name }
  }

  async createService(
    clientId: string,
    siteId: string,
    slug: string,
  ): Promise<{ id: string; name: string }> {
    const name = `${E2E_PREFIX} ${slug} ${uniqueSuffix()}`
    const { data, error } = await this.admin
      .from('services')
      .insert({
        client_id: clientId,
        site_id: siteId,
        name,
        weekdays: [1, 2, 3, 4, 5],
        start_time: '08:00',
        end_time: '16:00',
        required_staff: 2,
        valid_from: this.today,
        status: 'active',
      })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear el servicio: ${error.message}`)
    this.serviceIds.push(data.id)
    return { id: data.id, name }
  }

  /** Persona descartable con rol `employee` o `supervisor` y ficha de `employees`. */
  async createPerson(
    slug: string,
    role: 'employee' | 'supervisor',
  ): Promise<DisposableUser> {
    const env = readE2eResponsiveEnv()!
    const suffix = uniqueSuffix()
    const email = `e2e-p172-${slug}-${suffix}@example.com`
    const password = `${env.seedPassword}-${slug}`
    const firstName = E2E_PREFIX
    const lastName = `${slug} ${suffix}`
    const { data, error } = await this.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    })
    if (error || !data.user) {
      throw new Error(`No se pudo crear ${email}: ${error?.message}`)
    }
    const profileId = data.user.id
    this.profileIds.push(profileId)
    const { error: roleError } = await this.admin
      .from('user_roles')
      .insert({ profile_id: profileId, role })
    if (roleError) throw new Error(`Rol ${role}: ${roleError.message}`)
    const { error: employeeError } = await this.admin.from('employees').insert({
      profile_id: profileId,
      dni: `${Date.now()}${Math.floor(Math.random() * 100)}`,
      hire_date: this.today,
      status: 'active',
    })
    if (employeeError) {
      throw new Error(`Ficha employees: ${employeeError.message}`)
    }
    return { profileId, email, password, firstName, lastName }
  }

  /** Turno con franja fija (`HH:MM`) en `date` (por omisión, hoy). */
  async createShift(
    clientId: string,
    siteId: string,
    startTime: string,
    endTime: string,
    requiredStaff = 1,
    date: string = this.today,
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('shifts')
      .insert({
        client_id: clientId,
        site_id: siteId,
        shift_date: date,
        start_time: startTime,
        end_time: endTime,
        required_staff: requiredStaff,
        notes: `${E2E_PREFIX} turno de prueba`,
      })
      .select('id')
      .single()
    if (error) throw new Error(`No se pudo crear el turno: ${error.message}`)
    this.shiftIds.push(data.id)
    return data.id
  }

  async assign(shiftId: string, employeeId: string): Promise<string> {
    const owner = await this.owner()
    const { data, error } = await owner.rpc('assign_employee', {
      p_shift_id: shiftId,
      p_employee_id: employeeId,
    })
    if (error) throw new Error(`No se pudo asignar: ${error.message}`)
    const id = (data as unknown as { assignment: { id: string } }).assignment.id
    this.assignmentIds.push(id)
    return id
  }

  async assignSupervision(
    shiftId: string,
    supervisorId: string,
  ): Promise<string> {
    const owner = await this.owner()
    const { data, error } = await owner.rpc('assign_supervision', {
      p_shift_id: shiftId,
      p_supervisor_id: supervisorId,
    })
    if (error) {
      throw new Error(`No se pudo asignar la supervisión: ${error.message}`)
    }
    const id = (data as unknown as { supervision: { id: string } }).supervision
      .id
    this.supervisionIds.push(id)
    return id
  }

  async recordCheckIn(assignmentId: string): Promise<void> {
    const owner = await this.owner()
    const { error } = await owner.rpc('admin_record_attendance', {
      p_assignment_id: assignmentId,
      p_kind: 'check_in',
      p_reason: `${E2E_PREFIX} inicio de fixture`,
    })
    if (error) {
      throw new Error(`No se pudo registrar el inicio: ${error.message}`)
    }
  }

  /**
   * Limpieza: borrado físico de lo que creó la suite (hijos antes que padres). Lo que la base no
   * deja borrar queda con baja lógica (sede inactiva, cliente cerrado, cuenta baneada). Los
   * fallos no rompen la prueba: se devuelven como notas para informarlos.
   */
  async cleanup(): Promise<string[]> {
    const notes: string[] = []
    const now = new Date().toISOString()
    const note = (what: string, error: { message: string } | null) => {
      if (error) notes.push(`${what}: ${error.message}`)
    }

    if (this.supervisionIds.length > 0) {
      note(
        'borrar supervision_attendance',
        (
          await this.admin
            .from('supervision_attendance')
            .delete()
            .in('supervision_id', this.supervisionIds)
        ).error,
      )
      note(
        'borrar ratings',
        (
          await this.admin
            .from('ratings')
            .delete()
            .in('supervision_id', this.supervisionIds)
        ).error,
      )
      const { error } = await this.admin
        .from('supervisions')
        .delete()
        .in('id', this.supervisionIds)
      if (error) {
        // Si no se puede borrar, se cancela (estado terminal) para que no moleste a otros.
        const owner = await this.owner()
        for (const id of this.supervisionIds) {
          await owner.rpc('cancel_supervision', {
            p_supervision_id: id,
            p_reason: `${E2E_PREFIX}: limpieza`,
          })
        }
        notes.push(
          `supervisiones canceladas (no se pudieron borrar): ${error.message}`,
        )
      }
    }
    if (this.assignmentIds.length > 0) {
      note(
        'borrar attendance_notices',
        (
          await this.admin
            .from('attendance_notices')
            .delete()
            .in('assignment_id', this.assignmentIds)
        ).error,
      )
      note(
        'borrar attendance_records',
        (
          await this.admin
            .from('attendance_records')
            .delete()
            .in('assignment_id', this.assignmentIds)
        ).error,
      )
    }
    if (this.shiftIds.length > 0) {
      note(
        'borrar assignments',
        (
          await this.admin
            .from('assignments')
            .delete()
            .in('shift_id', this.shiftIds)
        ).error,
      )
      note(
        'borrar shift_tasks',
        (
          await this.admin
            .from('shift_tasks')
            .delete()
            .in('shift_id', this.shiftIds)
        ).error,
      )
      note(
        'borrar shifts',
        (await this.admin.from('shifts').delete().in('id', this.shiftIds))
          .error,
      )
    }
    if (this.serviceIds.length > 0) {
      const { error } = await this.admin
        .from('services')
        .delete()
        .in('id', this.serviceIds)
      if (error) {
        note(
          'baja lógica de servicios',
          (
            await this.admin
              .from('services')
              .update({ status: 'ended', deleted_at: now })
              .in('id', this.serviceIds)
          ).error,
        )
      }
    }
    if (this.siteIds.length > 0) {
      const { error } = await this.admin
        .from('sites')
        .delete()
        .in('id', this.siteIds)
      if (error) {
        note(
          'baja lógica de sedes',
          (
            await this.admin
              .from('sites')
              .update({ status: 'inactive', deleted_at: now })
              .in('id', this.siteIds)
          ).error,
        )
      }
    }
    if (this.clientIds.length > 0) {
      const { error } = await this.admin
        .from('clients')
        .delete()
        .in('id', this.clientIds)
      if (error) {
        note(
          'baja lógica de clientes',
          (
            await this.admin
              .from('clients')
              .update({ status: 'closed', deleted_at: now })
              .in('id', this.clientIds)
          ).error,
        )
      }
    }
    for (const profileId of this.profileIds) {
      await this.admin
        .from('admin_capabilities')
        .delete()
        .eq('profile_id', profileId)
      await this.admin.from('employees').delete().eq('profile_id', profileId)
      await this.admin.from('user_roles').delete().eq('profile_id', profileId)
      // `profiles` antes que la cuenta de Auth: sin eso `deleteUser` falla por la referencia.
      await this.admin.from('profiles').delete().eq('id', profileId)
      const { error } = await this.admin.auth.admin.deleteUser(profileId)
      if (error) {
        await this.admin.auth.admin.updateUserById(profileId, {
          ban_duration: '876000h',
        })
        await this.admin
          .from('profiles')
          .update({ is_active: false, deleted_at: now })
          .eq('id', profileId)
        notes.push(
          `cuenta ${profileId} baneada (no se pudo borrar): ${error.message}`,
        )
      }
    }
    if (this.ownerClient) {
      await this.ownerClient.auth.signOut()
    }
    return notes
  }
}

/** Datos que comparten todos los specs de la suite. */
export interface ResponsiveData {
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  serviceId: string
  employee: DisposableUser // asignado hoy, todavía sin fichar
  employeeWorking: DisposableUser // ya fichó el inicio (turno en curso)
  supervisor: DisposableUser
  shiftId: string // turno de hoy, dos empleados, con supervisión
  uncoveredShiftId: string // turno de hoy sin cubrir
  supervisionId: string
  assignmentId: string // del empleado sin fichar
  workingAssignmentId: string // del empleado en curso
  futureDate: string // un día cercano con turno
}

/** Arma el escenario completo con datos para todas las pantallas. */
export async function buildResponsiveData(
  scenario: ResponsiveScenario,
): Promise<ResponsiveData> {
  const client = await scenario.createClient('cliente')
  const site = await scenario.createSite(client.id, 'sede')
  const service = await scenario.createService(client.id, site.id, 'servicio')
  const employee = await scenario.createPerson('empleado', 'employee')
  const employeeWorking = await scenario.createPerson('en-curso', 'employee')
  const supervisor = await scenario.createPerson('supervisor', 'supervisor')

  // Turno de hoy todo el día, con dos empleados y una supervisión.
  const shiftId = await scenario.createShift(
    client.id,
    site.id,
    '00:00',
    '23:59',
    3,
  )
  const assignmentId = await scenario.assign(shiftId, employee.profileId)
  const workingAssignmentId = await scenario.assign(
    shiftId,
    employeeWorking.profileId,
  )
  await scenario.recordCheckIn(workingAssignmentId)
  const supervisionId = await scenario.assignSupervision(
    shiftId,
    supervisor.profileId,
  )
  // Un turno de hoy sin cubrir y varios en otros días cercanos.
  const uncoveredShiftId = await scenario.createShift(
    client.id,
    site.id,
    '00:00',
    '12:00',
    2,
  )
  const futureDate = addDaysISO(scenario.today, 3)
  await scenario.createShift(
    client.id,
    site.id,
    '08:00',
    '16:00',
    1,
    futureDate,
  )
  await scenario.createShift(
    client.id,
    site.id,
    '08:00',
    '16:00',
    1,
    addDaysISO(scenario.today, -1),
  )
  await scenario.createShift(
    client.id,
    site.id,
    '14:00',
    '18:00',
    1,
    addDaysISO(scenario.today, 1),
  )

  return {
    clientId: client.id,
    clientName: client.name,
    siteId: site.id,
    siteName: site.name,
    serviceId: service.id,
    employee,
    employeeWorking,
    supervisor,
    shiftId,
    uncoveredShiftId,
    supervisionId,
    assignmentId,
    workingAssignmentId,
    futureDate,
  }
}
