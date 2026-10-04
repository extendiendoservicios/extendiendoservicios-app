// tests/e2e-tablero/helpers/fixtures.ts — DASH-008/DASH-009 (P16.2)
//
// Datos de prueba del tablero, con prefijo `E2E-P162`, creados y borrados por la propia suite.
//
// Anclaje de las fechas y las horas (regla del encargo, "el CI corre a cualquier hora"):
//  - Todos los turnos son del día de HOY de Argentina, calculado UNA vez al armar el escenario.
//  - Nada se arma con "ahora + n minutos". Las franjas son fijas dentro del día del turno:
//    * "ya pasó" (sin registro, en curso pasada la hora de fin): 00:00–00:01. A cualquier hora del
//      día, salvo los primeros minutos después de la medianoche, esa franja ya terminó -- por eso
//      los specs se saltean en esa ventana (`isTooCloseToMidnight`).
//    * "más tarde": franjas de la tarde-noche, que nunca se usan para afirmar algo que dependa de
//      que ya hayan empezado.
//  - El reloj del servidor (`now()` de `v_assignments_board`/`v_shifts_board`) no se puede
//    controlar desde afuera: por eso las franjas de "ya pasó" son las del comienzo del día, no
//    desplazamientos contra la hora de la corrida.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types.ts'
import { SEED_ACCOUNTS } from '../../fixtures/seed-accounts.ts'
import { readE2eTableroEnv } from './env.ts'

export type AdminClient = SupabaseClient<Database>

export const E2E_PREFIX = 'E2E-P162'

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires'

/** Fecha de hoy en Argentina como `YYYY-MM-DD`. */
export function argentinaTodayISODate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ARGENTINA_TZ }).format(
    new Date(),
  )
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

/**
 * Cerca de la medianoche de Argentina el escenario no es estable: justo después de las 0:00 la
 * franja 00:00–00:01 todavía no terminó, y justo antes de las 24:00 el "hoy" del tablero cambia a
 * mitad de la prueba. Los specs se saltean en esa ventana (6 min antes y 4 min después) con un
 * motivo explícito, en vez de inventar un reloj falso en el servidor.
 */
export function isTooCloseToMidnight(): boolean {
  const since = argentinaMinutesSinceMidnight()
  return since < 4 || since > 24 * 60 - 6
}

export const NEAR_MIDNIGHT_MESSAGE =
  'Estamos a menos de 6 minutos de la medianoche de Argentina (o recién pasada): el "hoy" del ' +
  'tablero cambia durante la corrida o la franja 00:00–00:01 todavía no terminó. Se saltea ' +
  'explícito -- reintentar unos minutos más tarde.'

let cachedAdmin: AdminClient | null = null

export function getAdminClient(): AdminClient {
  if (cachedAdmin) return cachedAdmin
  const env = readE2eTableroEnv()
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

export const ADMIN_CAPABILITIES = [
  'manage_users',
  'cancel_shifts',
  'edit_ratings',
  'edit_checklists',
  'manage_attendance',
  'generate_shifts',
  'manage_supervisions',
] as const
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number]

/**
 * Armador de datos de una prueba: registra todo lo que crea y lo borra en `cleanup()`.
 * `service_role` no puede insertar en `assignments` ni llamar a las RPC de negocio (no hay
 * `auth.uid()`): esas operaciones van con una sesión del dueño del seed, abierta una sola vez.
 */
export class TableroScenario {
  readonly admin = getAdminClient()
  readonly shiftDate = argentinaTodayISODate()

  private ownerClient: AdminClient | null = null
  private readonly clientIds: string[] = []
  private readonly siteIds: string[] = []
  private readonly shiftIds: string[] = []
  private readonly assignmentIds: string[] = []
  private readonly profileIds: string[] = []

  /** Sesión del dueño del seed para las RPC (`assign_employee`, `notify_absence`). */
  async owner(): Promise<AdminClient> {
    if (this.ownerClient) return this.ownerClient
    const env = readE2eTableroEnv()!
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

  /** Empleado descartable (cuenta de Auth + `profiles` por trigger + `user_roles` + `employees`). */
  async createEmployee(slug: string): Promise<DisposableUser> {
    const env = readE2eTableroEnv()!
    const suffix = uniqueSuffix()
    const email = `e2e-p162-${slug}-${suffix}@example.com`
    const password = `${env.seedPassword}-${slug}`
    const firstName = E2E_PREFIX
    const lastName = `${slug} ${suffix}`
    const profileId = await this.createUser(
      email,
      password,
      firstName,
      lastName,
    )
    const { error: roleError } = await this.admin
      .from('user_roles')
      .insert({ profile_id: profileId, role: 'employee' })
    if (roleError) throw new Error(`Rol employee: ${roleError.message}`)
    const { error: employeeError } = await this.admin.from('employees').insert({
      profile_id: profileId,
      dni: `${Date.now()}${Math.floor(Math.random() * 100)}`,
      hire_date: this.shiftDate,
      status: 'active',
    })
    if (employeeError) {
      throw new Error(`Ficha employees: ${employeeError.message}`)
    }
    return { profileId, email, password, firstName, lastName }
  }

  /** Administrador descartable con las siete capacidades salvo las indicadas. */
  async createAdminWithout(
    slug: string,
    disabled: readonly AdminCapability[],
  ): Promise<DisposableUser> {
    const env = readE2eTableroEnv()!
    const suffix = uniqueSuffix()
    const email = `e2e-p162-${slug}-${suffix}@example.com`
    const password = `${env.seedPassword}-${slug}`
    const lastName = `Admin ${slug} ${suffix}`
    const profileId = await this.createUser(
      email,
      password,
      E2E_PREFIX,
      lastName,
    )
    const { error: roleError } = await this.admin
      .from('user_roles')
      .insert({ profile_id: profileId, role: 'admin', granted_by: null })
    if (roleError) throw new Error(`Rol admin: ${roleError.message}`)
    const { error: capsError } = await this.admin
      .from('admin_capabilities')
      .insert(
        ADMIN_CAPABILITIES.map((capability) => ({
          profile_id: profileId,
          capability,
          enabled: !disabled.includes(capability),
          updated_by: null,
        })),
      )
    if (capsError) throw new Error(`Capacidades: ${capsError.message}`)
    return { profileId, email, password, firstName: E2E_PREFIX, lastName }
  }

  private async createUser(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ): Promise<string> {
    const { data, error } = await this.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    })
    if (error || !data.user) {
      throw new Error(`No se pudo crear ${email}: ${error?.message}`)
    }
    this.profileIds.push(data.user.id)
    return data.user.id
  }

  /** Turno del día del escenario con franja fija (`HH:MM`). */
  async createShift(
    clientId: string,
    siteId: string,
    startTime: string,
    endTime: string,
    requiredStaff = 1,
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('shifts')
      .insert({
        client_id: clientId,
        site_id: siteId,
        shift_date: this.shiftDate,
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

  /** `assign_employee` real (la fila de `assignments` no se puede insertar directo). */
  async assign(shiftId: string, employeeId: string): Promise<string> {
    const owner = await this.owner()
    const { data, error } = await owner.rpc('assign_employee', {
      p_shift_id: shiftId,
      p_employee_id: employeeId,
    })
    if (error) {
      throw new Error(`No se pudo asignar: ${error.message}`)
    }
    const id = (data as unknown as { assignment: { id: string } }).assignment.id
    this.assignmentIds.push(id)
    return id
  }

  /** Aviso de ausencia en nombre del empleado (admin, permitido antes y después del inicio). */
  async notifyAbsence(assignmentId: string): Promise<void> {
    const owner = await this.owner()
    const { error } = await owner.rpc('notify_absence', {
      p_assignment_id: assignmentId,
      p_reason_code: 'illness',
    })
    if (error) {
      throw new Error(`No se pudo avisar la ausencia: ${error.message}`)
    }
  }

  /** Registra el inicio en nombre del empleado (`admin_record_attendance`). */
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
   * Limpieza. Primero intenta el borrado físico de todo lo que creó la suite (hijos antes que
   * padres); lo que la base no deje borrar queda con baja lógica (sede inactiva, cliente
   * cerrado, cuenta baneada). Los fallos no rompen
   * la prueba: se devuelven como notas para que el spec los pueda informar.
   */
  async cleanup(): Promise<string[]> {
    const notes: string[] = []
    const now = new Date().toISOString()
    const note = (what: string, error: { message: string } | null) => {
      if (error) notes.push(`${what}: ${error.message}`)
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
      // Hay que borrar `profiles` antes que la cuenta de Auth: sin eso `deleteUser` falla
      // ("Database error deleting user") por la referencia desde `profiles`.
      await this.admin.from('profiles').delete().eq('id', profileId)
      const { error } = await this.admin.auth.admin.deleteUser(profileId)
      if (error) {
        // No se pudo borrar la cuenta (queda referenciada): se deja inutilizable.
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
