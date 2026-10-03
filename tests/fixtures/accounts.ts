// tests/fixtures/accounts.ts — TEST-015/TEST-016 (P18.1)
//
// Juego ESTABLE de cuentas de prueba por rol (decisión de Mike, 3 oct 2026). Las suites de F18
// las reutilizan en vez de crear cuentas nuevas en cada corrida: como nada se borra físicamente
// (P-014, `auth.admin.deleteUser` falla por diseño), las cuentas descartables se acumulaban
// baneadas en `App_dev`. Solo los tests que prueban alta, baja o reactivación de usuarios crean
// cuentas nuevas (con el prefijo `e2e-` y un sufijo único).
//
// `ensureFixedAccounts` es idempotente: si la cuenta existe, la deja activa, con su rol y su
// perfil correctos y con la contraseña vigente de `SEED_DEV_PASSWORD`; si no existe, la crea.
// Correrlo dos veces seguidas no crea nada nuevo.
//
// El DUEÑO no es una cuenta fija nueva: se usa el dueño del seed (`extserviciosapp@gmail.com`).
// Un segundo dueño haría que `last-owner-cannot-be-deactivated.spec.ts` (e2e-users) desactivara
// de verdad al dueño real, porque esa prueba depende de que haya un solo dueño activo.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types.ts'
import { requireE2eEnv } from './env.ts'

export type AppRole = Database['public']['Enums']['app_role']
export type AdminCapability = Database['public']['Enums']['admin_capability']
export type AdminDb = SupabaseClient<Database>

export const ADMIN_CAPABILITIES: readonly AdminCapability[] = [
  'manage_users',
  'cancel_shifts',
  'edit_ratings',
  'edit_checklists',
  'manage_attendance',
  'generate_shifts',
  'manage_supervisions',
]

/** Dueño del seed (`supabase/seed.sql`, `scripts/seed-dev.ts`): cuenta estable, no se crea acá. */
export const OWNER_EMAIL = 'extserviciosapp@gmail.com'

export type FixedAccountKey =
  | 'admin'
  | 'adminSinCapacidades'
  | 'adminCapacidades'
  | 'empleado1'
  | 'empleado2'
  | 'empleado3'
  | 'empleado4'
  | 'supervisor1'
  | 'supervisor2'
  | 'dual'

export interface FixedAccountSpec {
  /** Clave corta con la que las suites piden la cuenta. */
  key: FixedAccountKey
  email: string
  firstName: string
  lastName: string
  roles: readonly AppRole[]
  /** Solo para administradores: capacidades que quedan habilitadas (las demás, deshabilitadas). */
  capabilities?: readonly AdminCapability[]
  /** DNI fijo de la ficha de `employees` (empleados y supervisores). */
  dni?: string
}

const DOMAIN = 'example.com'
const FIRST_NAME = 'E2E-Fijo'

function person(
  key: FixedAccountKey,
  emailSlug: string,
  lastName: string,
  roles: readonly AppRole[],
  dni?: string,
): FixedAccountSpec {
  return {
    key,
    email: `e2e-fijo-${emailSlug}@${DOMAIN}`,
    firstName: FIRST_NAME,
    lastName,
    roles,
    dni,
  }
}

/**
 * Cantidad por rol pensada para las suites en paralelo: cuatro empleados (una asignación por
 * test sin pisarse), dos supervisores, una persona con los dos roles y tres administradores
 * (todas las capacidades, ninguna, y una cuyas capacidades cambia el test de capacidades).
 */
export const FIXED_ACCOUNTS: Record<FixedAccountKey, FixedAccountSpec> = {
  admin: {
    ...person('admin', 'admin', 'Admin', ['admin']),
    capabilities: ADMIN_CAPABILITIES,
  },
  adminSinCapacidades: {
    ...person(
      'adminSinCapacidades',
      'admin-sin-capacidades',
      'AdminSinCapacidades',
      ['admin'],
    ),
    capabilities: [],
  },
  adminCapacidades: {
    ...person('adminCapacidades', 'admin-capacidades', 'AdminCapacidades', [
      'admin',
    ]),
    capabilities: ADMIN_CAPABILITIES,
  },
  empleado1: person(
    'empleado1',
    'empleado-1',
    'Empleado1',
    ['employee'],
    '99000001',
  ),
  empleado2: person(
    'empleado2',
    'empleado-2',
    'Empleado2',
    ['employee'],
    '99000002',
  ),
  empleado3: person(
    'empleado3',
    'empleado-3',
    'Empleado3',
    ['employee'],
    '99000003',
  ),
  empleado4: person(
    'empleado4',
    'empleado-4',
    'Empleado4',
    ['employee'],
    '99000004',
  ),
  supervisor1: person(
    'supervisor1',
    'supervisor-1',
    'Supervisor1',
    ['supervisor'],
    '99000011',
  ),
  supervisor2: person(
    'supervisor2',
    'supervisor-2',
    'Supervisor2',
    ['supervisor'],
    '99000012',
  ),
  dual: person('dual', 'dual', 'Dual', ['employee', 'supervisor'], '99000021'),
}

/** Todas las cuentas fijas, en orden estable. */
export const FIXED_ACCOUNT_LIST: readonly FixedAccountSpec[] =
  Object.values(FIXED_ACCOUNTS)

/** Nombre completo como se ve en las pantallas (`first_name last_name`). */
export function fullName(spec: FixedAccountSpec): string {
  return `${spec.firstName} ${spec.lastName}`
}

/** Cliente con la clave de servicio (RLS salteada), solo para preparar y limpiar datos. */
let cachedAdminDb: AdminDb | null = null
export function getAdminDb(): AdminDb {
  if (cachedAdminDb) return cachedAdminDb
  const env = requireE2eEnv()
  cachedAdminDb = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedAdminDb
}

/** Todos los usuarios de Auth por email en minúscula (App_dev acumula cuentas: se pagina). */
export async function loadAuthUserIds(
  db: AdminDb,
): Promise<Map<string, string>> {
  const perPage = 1000
  const byEmail = new Map<string, string>()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`No se pudo listar usuarios: ${error.message}`)
    for (const user of data.users) {
      if (user.email) byEmail.set(user.email.toLowerCase(), user.id)
    }
    if (data.users.length < perPage) break
  }
  return byEmail
}

/** Busca un usuario de Auth por email. */
export async function findAuthUserIdByEmail(
  db: AdminDb,
  email: string,
): Promise<string | null> {
  return (await loadAuthUserIds(db)).get(email.toLowerCase()) ?? null
}

export interface EnsureResult {
  created: string[]
  existing: string[]
  ids: Record<string, string>
}

async function must(
  what: string,
  who: string,
  query: PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const { error } = await query
  if (error) throw new Error(`${what} de ${who}: ${error.message}`)
}

/**
 * Crea las cuentas fijas que falten y deja TODAS activas y completas. Idempotente: las que ya
 * existen se reutilizan (se les repone contraseña, perfil, roles, capacidades y ficha).
 */
export async function ensureFixedAccounts(
  db: AdminDb = getAdminDb(),
): Promise<EnsureResult> {
  const env = requireE2eEnv()
  const result: EnsureResult = { created: [], existing: [], ids: {} }
  const authIds = await loadAuthUserIds(db)

  for (const spec of FIXED_ACCOUNT_LIST) {
    let userId = authIds.get(spec.email.toLowerCase()) ?? null

    if (!userId) {
      const { data, error } = await db.auth.admin.createUser({
        email: spec.email,
        password: env.seedPassword,
        email_confirm: true,
        user_metadata: { first_name: spec.firstName, last_name: spec.lastName },
      })
      if (error || !data.user) {
        throw new Error(
          `No se pudo crear la cuenta fija ${spec.email}: ${error?.message ?? 'sin usuario'}`,
        )
      }
      userId = data.user.id
      result.created.push(spec.email)
    } else {
      // Contraseña vigente y sin baneo (por si una corrida anterior la dejó baneada).
      const { error } = await db.auth.admin.updateUserById(userId, {
        password: env.seedPassword,
        email_confirm: true,
        ban_duration: 'none',
        user_metadata: { first_name: spec.firstName, last_name: spec.lastName },
      })
      if (error) {
        throw new Error(
          `No se pudo reponer la cuenta fija ${spec.email}: ${error.message}`,
        )
      }
      result.existing.push(spec.email)
    }
    result.ids[spec.key] = userId

    // Perfil (lo crea el trigger `app.handle_new_user()`): activo y con el nombre fijo.
    await must(
      'perfil',
      spec.email,
      db
        .from('profiles')
        .update({
          is_active: true,
          deleted_at: null,
          first_name: spec.firstName,
          last_name: spec.lastName,
        })
        .eq('id', userId),
    )

    // Roles: exactamente los del spec.
    const { data: currentRoles, error: rolesError } = await db
      .from('user_roles')
      .select('role')
      .eq('profile_id', userId)
    if (rolesError) {
      throw new Error(`Roles de ${spec.email}: ${rolesError.message}`)
    }
    const have = new Set((currentRoles ?? []).map((r) => r.role))
    for (const role of have) {
      if (!spec.roles.includes(role)) {
        await must(
          'quitar rol',
          spec.email,
          db
            .from('user_roles')
            .delete()
            .eq('profile_id', userId)
            .eq('role', role),
        )
      }
    }
    for (const role of spec.roles) {
      if (!have.has(role)) {
        await must(
          'dar rol',
          spec.email,
          db.from('user_roles').insert({ profile_id: userId, role }),
        )
      }
    }

    // Capacidades (solo administradores): las siete filas, con su estado inicial.
    if (spec.roles.includes('admin')) {
      await must(
        'capacidades',
        spec.email,
        db.from('admin_capabilities').upsert(
          ADMIN_CAPABILITIES.map((capability) => ({
            profile_id: userId,
            capability,
            enabled: spec.capabilities?.includes(capability) ?? false,
            updated_by: null,
          })),
          { onConflict: 'profile_id,capability' },
        ),
      )
    }

    // Ficha de `employees` (empleados y supervisores): activa, con DNI fijo.
    if (spec.dni) {
      const { data: row, error: rowError } = await db
        .from('employees')
        .select('profile_id')
        .eq('profile_id', userId)
        .maybeSingle()
      if (rowError) {
        throw new Error(`Ficha de ${spec.email}: ${rowError.message}`)
      }
      if (row) {
        await must(
          'ficha',
          spec.email,
          db
            .from('employees')
            .update({
              status: 'active',
              terminated_at: null,
              deleted_at: null,
            })
            .eq('profile_id', userId),
        )
      } else {
        await must(
          'ficha',
          spec.email,
          db.from('employees').insert({
            profile_id: userId,
            dni: spec.dni,
            hire_date: '2026-01-05',
            status: 'active',
          }),
        )
      }
    }
  }
  return result
}

/** Contraseña de las cuentas fijas: la de `SEED_DEV_PASSWORD` (nunca se escribe en el código). */
export function fixedPassword(): string {
  return requireE2eEnv().seedPassword
}

/** Id de la cuenta fija en Auth (el setup la dejó creada). */
export async function fixedAccountId(
  key: FixedAccountKey,
  db: AdminDb = getAdminDb(),
): Promise<string> {
  const id = await findAuthUserIdByEmail(db, FIXED_ACCOUNTS[key].email)
  if (!id) {
    throw new Error(
      `La cuenta fija ${FIXED_ACCOUNTS[key].email} no existe: corré el setup (tests/fixtures/setup-accounts.ts).`,
    )
  }
  return id
}
