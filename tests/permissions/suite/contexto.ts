// tests/permissions/suite/contexto.ts — TEST-019 (P18.3)
//
// Lo que el `globalSetup` arma UNA sola vez por corrida y reparte a los archivos de prueba con
// `provide`/`inject` de Vitest: los ids de las cuentas fijas (resueltos una vez, no dentro de
// cada caso: la intermitencia que quedó pendiente desde P04.7 era un límite de tasa de la Admin
// API al llamar `listUsers` desde varios archivos en paralelo), las sesiones (un solo inicio de
// sesión por cuenta y por corrida) y los ids de los datos plantados por el escenario.
//
// Los tokens viajan serializados: cada archivo arma sus clientes con la cabecera `Authorization`
// (sin pasar por `signInWithPassword` de nuevo y sin renovar sesiones: renovar un token con la
// rotación de refresh tokens invalidaría el de los demás archivos).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { inject } from 'vitest'
import type { Database } from '../../../src/lib/database.types.ts'
import { requireE2eEnv } from '../../fixtures/env.ts'
import type { Perfil, PerfilConSesion } from './perfiles.ts'

export type Db = SupabaseClient<Database>

/** Ids de las cuentas fijas y del dueño, por clave corta. */
export interface IdsCuentas {
  owner: string
  admin: string
  adminSin: string
  adminCapacidades: string
  empleado1: string
  empleado2: string
  empleado3: string
  empleado4: string
  supervisor1: string
  supervisor2: string
  dual: string
}

/** Ids de los datos plantados (todos con prefijo `e2e-perm-`). */
export interface IdsEscenario {
  clienteA: string
  clienteB: string
  sedeA: string
  sedeB: string
  servicioA: string
  turnoA: string
  turnoB: string
  turnoD: string
  /** Asignaciones: empleado1 y empleado2 en A; empleado3 en B; empleado4 y doble rol en D. */
  asigE1: string
  asigE2: string
  asigE3: string
  asigE4: string
  asigDual: string
  /** Supervisiones: supervisor1 en A, supervisor2 en B, el doble rol en D. */
  supA: string
  supB: string
  supD: string
  tareaA: string
  tareaB: string
  plantillaA: string
  plantillaB: string
  itemA: string
  itemB: string
  contactoA: string
  contactoB: string
  disponibilidadE1: string
  disponibilidadE3: string
  licenciaE1: string
  licenciaE3: string
  asistenciaE1: string
  asistenciaE2: string
  asistenciaE3: string
  avisoE1: string
  avisoE2: string
  avisoE3: string
  calificacionA: string
  calificacionB: string
  asistSupA: string
  asistSupB: string
  criterio: string
  feriado: string
  evento: string
}

export interface Contexto {
  ids: IdsCuentas
  e: IdsEscenario
  /** Tokens de acceso por perfil con sesión, y el del administrador que cambia de capacidades. */
  tokens: Record<PerfilConSesion | 'adminCapacidades', string>
  /** Refresh token del administrador de capacidades (la prueba de capacidades renueva su sesión). */
  refreshAdminCapacidades: string
  /** Refresh token del empleado (la prueba de desactivados renueva su sesión una vez). */
  refreshEmpleado: string
  /** Fecha del turno plantado (hoy + 3, hora de Argentina). */
  fechaTurno: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    permisos: Contexto
  }
}

export function contexto(): Contexto {
  return inject('permisos')
}

/** Cliente `anon` o con la sesión del perfil (cabecera `Authorization`, sin renovar nada). */
export function clienteDe(perfil: Perfil): Db {
  const env = requireE2eEnv()
  const token = perfil === 'anon' ? null : contexto().tokens[perfil]
  return createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(token
      ? { global: { headers: { Authorization: `Bearer ${token}` } } }
      : {}),
  })
}

/** Cliente con un token puntual (por ejemplo, el de una sesión ya desactivada). */
export function clienteConToken(token: string): Db {
  const env = requireE2eEnv()
  return createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

/** Cliente con la clave de servicio: solo para preparar y verificar, nunca para probar un rol. */
let admin: Db | null = null
export function servicio(): Db {
  if (admin) return admin
  const env = requireE2eEnv()
  admin = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return admin
}

/** Id de cada perfil con sesión (no existe para `anon`). */
export function idDe(perfil: PerfilConSesion): string {
  const ids = contexto().ids
  return ids[
    perfil === 'empleado'
      ? 'empleado1'
      : perfil === 'supervisor'
        ? 'supervisor1'
        : perfil
  ]
}
