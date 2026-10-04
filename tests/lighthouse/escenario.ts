// tests/lighthouse/escenario.ts — RESP-010 (P17.4)
//
// Cuentas y datos descartables (prefijo `E2E-P174`) para medir con sesión las pantallas de
// empleado y supervisor con algo que mostrar. Se crean al empezar y se borran al terminar.
// Mismo criterio que `tests/e2e-responsive/helpers/fixtures.ts` (autocontenido, versión reducida).
// El dueño es el de la semilla de `App_dev`: ADM-02 solo se lee; con esa cuenta únicamente se
// llaman las RPC de asignación sobre los turnos descartables.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types.ts'
import { SEED_ACCOUNTS } from '../fixtures/seed-accounts.ts'

export const PREFIJO = 'E2E-P174'

// Proyecto `App` (producción): nunca se mide ni se crean datos ahí.
const FRAGMENTO_PRODUCCION = 'fysuppdadwvabrjpnnoh'

type Cliente = SupabaseClient<Database>

export interface Entorno {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  seedPassword: string
}

export function leerEntorno(): Entorno | null {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const seedPassword = process.env.SEED_DEV_PASSWORD
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !seedPassword) return null
  if (supabaseUrl.includes(FRAGMENTO_PRODUCCION)) {
    throw new Error(
      'VITE_SUPABASE_URL apunta al proyecto de PRODUCCIÓN (App). Se corta antes de crear nada.',
    )
  }
  return { supabaseUrl, anonKey, serviceRoleKey, seedPassword }
}

export interface Cuenta {
  profileId: string
  email: string
  password: string
}

export function hoyArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

export class EscenarioLighthouse {
  private readonly admin: Cliente
  private dueno: Cliente | null = null
  private readonly hoy = hoyArgentina()
  private readonly ids = {
    clientes: [] as string[],
    sedes: [] as string[],
    turnos: [] as string[],
    asignaciones: [] as string[],
    supervisiones: [] as string[],
    perfiles: [] as string[],
  }
  empleado!: Cuenta
  supervisor!: Cuenta

  private readonly env: Entorno

  constructor(env: Entorno) {
    this.env = env
    this.admin = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }

  get duenoSemilla(): Cuenta {
    return {
      profileId: '',
      email: SEED_ACCOUNTS.owner,
      password: this.env.seedPassword,
    }
  }

  private async sesionDueno(): Promise<Cliente> {
    if (this.dueno) return this.dueno
    const c = createClient<Database>(this.env.supabaseUrl, this.env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await c.auth.signInWithPassword({
      email: SEED_ACCOUNTS.owner,
      password: this.env.seedPassword,
    })
    if (error)
      throw new Error(`Sesión del dueño de la semilla: ${error.message}`)
    this.dueno = c
    return c
  }

  private async crearPersona(
    slug: string,
    rol: 'employee' | 'supervisor',
  ): Promise<Cuenta> {
    const sufijo = `${Date.now()}`
    const email = `e2e-p174-${slug}-${sufijo}@example.com`
    const password = `${this.env.seedPassword}-${slug}`
    const { data, error } = await this.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: PREFIJO, last_name: `${slug} ${sufijo}` },
    })
    if (error || !data.user) {
      throw new Error(`No se pudo crear ${email}: ${error?.message}`)
    }
    const profileId = data.user.id
    this.ids.perfiles.push(profileId)
    const r = await this.admin
      .from('user_roles')
      .insert({ profile_id: profileId, role: rol })
    if (r.error) throw new Error(`Rol ${rol}: ${r.error.message}`)
    const e = await this.admin.from('employees').insert({
      profile_id: profileId,
      dni: `${Date.now()}${Math.floor(Math.random() * 100)}`,
      hire_date: this.hoy,
      status: 'active',
    })
    if (e.error) throw new Error(`Ficha employees: ${e.error.message}`)
    return { profileId, email, password }
  }

  /** Crea cliente, sede, turno de hoy (todo el día), empleado asignado y supervisor con supervisión. */
  async armar(): Promise<void> {
    const nombre = `${PREFIJO} ${Date.now()}`
    const digitos = `${Date.now()}`.slice(-8) + Math.floor(Math.random() * 10)
    const cli = await this.admin
      .from('clients')
      .insert({
        legal_name: nombre,
        trade_name: nombre,
        cuit: `20${digitos}`,
        status: 'active',
      })
      .select('id')
      .single()
    if (cli.error) throw new Error(`Cliente: ${cli.error.message}`)
    this.ids.clientes.push(cli.data.id)
    const sede = await this.admin
      .from('sites')
      .insert({
        client_id: cli.data.id,
        name: nombre,
        address: 'Dirección de prueba, sin importancia',
        status: 'active',
      })
      .select('id')
      .single()
    if (sede.error) throw new Error(`Sede: ${sede.error.message}`)
    this.ids.sedes.push(sede.data.id)

    this.empleado = await this.crearPersona('empleado', 'employee')
    this.supervisor = await this.crearPersona('supervisor', 'supervisor')

    const turno = await this.admin
      .from('shifts')
      .insert({
        client_id: cli.data.id,
        site_id: sede.data.id,
        shift_date: this.hoy,
        start_time: '00:00',
        end_time: '23:59',
        required_staff: 1,
        notes: `${PREFIJO} turno de prueba`,
      })
      .select('id')
      .single()
    if (turno.error) throw new Error(`Turno: ${turno.error.message}`)
    this.ids.turnos.push(turno.data.id)

    const dueno = await this.sesionDueno()
    const asig = await dueno.rpc('assign_employee', {
      p_shift_id: turno.data.id,
      p_employee_id: this.empleado.profileId,
    })
    if (asig.error) throw new Error(`Asignación: ${asig.error.message}`)
    this.ids.asignaciones.push(
      (asig.data as unknown as { assignment: { id: string } }).assignment.id,
    )
    const sup = await dueno.rpc('assign_supervision', {
      p_shift_id: turno.data.id,
      p_supervisor_id: this.supervisor.profileId,
    })
    if (sup.error) throw new Error(`Supervisión: ${sup.error.message}`)
    this.ids.supervisiones.push(
      (sup.data as unknown as { supervision: { id: string } }).supervision.id,
    )
  }

  /** Borra todo lo creado. Devuelve notas con lo que no se pudo borrar (queda con baja lógica). */
  async limpiar(): Promise<string[]> {
    const notas: string[] = []
    const ahora = new Date().toISOString()
    const nota = (que: string, error: { message: string } | null) => {
      if (error) notas.push(`${que}: ${error.message}`)
    }
    const a = this.admin
    const { supervisiones, asignaciones, turnos, sedes, clientes, perfiles } =
      this.ids
    if (supervisiones.length) {
      nota(
        'supervision_attendance',
        (
          await a
            .from('supervision_attendance')
            .delete()
            .in('supervision_id', supervisiones)
        ).error,
      )
      nota(
        'ratings',
        (await a.from('ratings').delete().in('supervision_id', supervisiones))
          .error,
      )
      nota(
        'supervisions',
        (await a.from('supervisions').delete().in('id', supervisiones)).error,
      )
    }
    if (asignaciones.length) {
      nota(
        'attendance_notices',
        (
          await a
            .from('attendance_notices')
            .delete()
            .in('assignment_id', asignaciones)
        ).error,
      )
      nota(
        'attendance_records',
        (
          await a
            .from('attendance_records')
            .delete()
            .in('assignment_id', asignaciones)
        ).error,
      )
    }
    if (turnos.length) {
      nota(
        'assignments',
        (await a.from('assignments').delete().in('shift_id', turnos)).error,
      )
      nota(
        'shift_tasks',
        (await a.from('shift_tasks').delete().in('shift_id', turnos)).error,
      )
      nota('shifts', (await a.from('shifts').delete().in('id', turnos)).error)
    }
    if (sedes.length) {
      const r = await a.from('sites').delete().in('id', sedes)
      if (r.error) {
        nota(
          'baja lógica de sedes',
          (
            await a
              .from('sites')
              .update({ status: 'inactive', deleted_at: ahora })
              .in('id', sedes)
          ).error,
        )
      }
    }
    if (clientes.length) {
      const r = await a.from('clients').delete().in('id', clientes)
      if (r.error) {
        nota(
          'baja lógica de clientes',
          (
            await a
              .from('clients')
              .update({ status: 'closed', deleted_at: ahora })
              .in('id', clientes)
          ).error,
        )
      }
    }
    for (const id of perfiles) {
      await a.from('employees').delete().eq('profile_id', id)
      await a.from('user_roles').delete().eq('profile_id', id)
      await a.from('profiles').delete().eq('id', id)
      const { error } = await a.auth.admin.deleteUser(id)
      if (error) {
        await a.auth.admin.updateUserById(id, { ban_duration: '876000h' })
        await a
          .from('profiles')
          .update({ is_active: false, deleted_at: ahora })
          .eq('id', id)
        notas.push(`cuenta ${id} baneada (no se pudo borrar): ${error.message}`)
      }
    }
    if (this.dueno) await this.dueno.auth.signOut()
    return notas
  }
}
