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

import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js'
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
  | 'empleado5'
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

// ---------------------------------------------------------------------------------------------
// Conjuntos de cuentas (TEST-021, P18.4). Para que las suites corran EN PARALELO en CI (un job
// por suite) sin que dos de ellas usen la misma cuenta fija, hay varios conjuntos disjuntos de
// las mismas cuentas, con la misma forma. El conjunto activo lo elige la variable
// `E2E_CONJUNTO` (por omisión `base`, el de siempre: así nada cambia al correr una suite sola en
// local). Cada conjunto tiene sus propios emails, nombres y DNI, por lo que dos conjuntos no se
// pisan ni en la base ni en lo que ve cada pantalla (un nombre no es subcadena de otro).
//
// El dueño del seed es único y NO tiene conjunto: lo comparten todas las suites. Compartirlo es
// seguro mientras nadie le cierre las sesiones (ver `docs/deployment.md` sección 14.5): el cierre
// de sesión del dueño (DEF-04, global) y todo lo que edita la configuración de la empresa corre
// en el proyecto `dueno-final`, que en CI es un job aparte, al final.
// ---------------------------------------------------------------------------------------------

export const CONJUNTOS = [
  'base',
  'edge',
  'emp-movil',
  'emp-webkit',
  'sup',
  'perm',
] as const
export type Conjunto = (typeof CONJUNTOS)[number]

interface DefConjunto {
  /** Infijo del email y sufijo del nombre ('' en el conjunto base). */
  tag: string
  /** Cuentas que ese conjunto necesita (las demás no se crean). */
  keys: readonly FixedAccountKey[]
}

const TODAS: readonly FixedAccountKey[] = [
  'admin',
  'adminSinCapacidades',
  'adminCapacidades',
  'empleado1',
  'empleado2',
  'empleado3',
  'empleado4',
  'supervisor1',
  'supervisor2',
  'dual',
]

// El empleado 5 es de la auditoría de accesibilidad de la suite de administración (ninguna otra
// cuenta puede ser suya sin pisarse con los archivos que corren en paralelo).
const TODAS_Y_EMPLEADO5: readonly FixedAccountKey[] = [...TODAS, 'empleado5']

const DEF_CONJUNTOS: Record<Conjunto, DefConjunto> = {
  base: { tag: '', keys: TODAS_Y_EMPLEADO5 },
  edge: { tag: 'eg', keys: TODAS_Y_EMPLEADO5 },
  'emp-movil': {
    tag: 'em',
    keys: ['empleado1', 'empleado2', 'empleado3', 'empleado4', 'supervisor1'],
  },
  'emp-webkit': {
    tag: 'ew',
    keys: ['empleado1', 'empleado2', 'empleado3', 'empleado4', 'supervisor1'],
  },
  sup: {
    tag: 'su',
    keys: ['empleado1', 'empleado2', 'supervisor1', 'supervisor2', 'dual'],
  },
  perm: { tag: 'pe', keys: TODAS },
}

/** Conjunto activo: `E2E_CONJUNTO` (por omisión `base`). Un valor desconocido corta la corrida. */
export function conjuntoActivo(): Conjunto {
  const valor = process.env.E2E_CONJUNTO?.trim() || 'base'
  if (!(CONJUNTOS as readonly string[]).includes(valor)) {
    throw new Error(
      `E2E_CONJUNTO="${valor}" no existe. Valores válidos: ${CONJUNTOS.join(', ')}.`,
    )
  }
  return valor as Conjunto
}

const DOMAIN = 'example.com'

interface Plantilla {
  key: FixedAccountKey
  slug: string
  lastName: string
  roles: readonly AppRole[]
  capabilities?: readonly AdminCapability[]
  /** Sufijo de 6 dígitos del DNI (el prefijo lo pone el conjunto). */
  dni?: string
}

const PLANTILLAS: readonly Plantilla[] = [
  {
    key: 'admin',
    slug: 'admin',
    lastName: 'Admin',
    roles: ['admin'],
    capabilities: ADMIN_CAPABILITIES,
  },
  {
    key: 'adminSinCapacidades',
    slug: 'admin-sin-capacidades',
    lastName: 'AdminSinCapacidades',
    roles: ['admin'],
    capabilities: [],
  },
  {
    key: 'adminCapacidades',
    slug: 'admin-capacidades',
    lastName: 'AdminCapacidades',
    roles: ['admin'],
    capabilities: ADMIN_CAPABILITIES,
  },
  {
    key: 'empleado1',
    slug: 'empleado-1',
    lastName: 'Empleado1',
    roles: ['employee'],
    dni: '000001',
  },
  {
    key: 'empleado2',
    slug: 'empleado-2',
    lastName: 'Empleado2',
    roles: ['employee'],
    dni: '000002',
  },
  {
    key: 'empleado3',
    slug: 'empleado-3',
    lastName: 'Empleado3',
    roles: ['employee'],
    dni: '000003',
  },
  {
    key: 'empleado4',
    slug: 'empleado-4',
    lastName: 'Empleado4',
    roles: ['employee'],
    dni: '000004',
  },
  {
    key: 'empleado5',
    slug: 'empleado-5',
    lastName: 'Empleado5',
    roles: ['employee'],
    dni: '000005',
  },
  {
    key: 'supervisor1',
    slug: 'supervisor-1',
    lastName: 'Supervisor1',
    roles: ['supervisor'],
    dni: '000011',
  },
  {
    key: 'supervisor2',
    slug: 'supervisor-2',
    lastName: 'Supervisor2',
    roles: ['supervisor'],
    dni: '000012',
  },
  {
    key: 'dual',
    slug: 'dual',
    lastName: 'Dual',
    roles: ['employee', 'supervisor'],
    dni: '000021',
  },
]

/** Las diez claves de un conjunto, con emails, nombres y DNI propios. */
function armarConjunto(
  conjunto: Conjunto,
): Record<FixedAccountKey, FixedAccountSpec> {
  const indice = CONJUNTOS.indexOf(conjunto)
  const { tag } = DEF_CONJUNTOS[conjunto]
  const out = {} as Record<FixedAccountKey, FixedAccountSpec>
  for (const p of PLANTILLAS) {
    out[p.key] = {
      key: p.key,
      email: `e2e-fijo-${tag ? `${tag}-` : ''}${p.slug}@${DOMAIN}`,
      // El conjunto base conserva el nombre de siempre ("E2E-Fijo Empleado1"); los demás llevan
      // su etiqueta en el nombre de pila ("E2E-Fijo-EM Empleado1"), que no contiene al otro.
      firstName: tag ? `E2E-Fijo-${tag.toUpperCase()}` : 'E2E-Fijo',
      lastName: p.lastName,
      roles: p.roles,
      capabilities: p.capabilities,
      // DNI de 8 dígitos: `99` + índice del conjunto + sufijo de la plantilla (base: `99000001`).
      dni: p.dni ? `99${indice}${p.dni.slice(1)}` : undefined,
    }
  }
  return out
}

/** Cuentas que el conjunto crea y repone (un subconjunto de las diez claves). */
export function cuentasDelConjunto(
  conjunto: Conjunto = conjuntoActivo(),
): FixedAccountSpec[] {
  const todas = armarConjunto(conjunto)
  return DEF_CONJUNTOS[conjunto].keys.map((k) => todas[k])
}

/**
 * Cuentas del conjunto activo por clave. Las diez claves tienen spec (email y nombre), pero solo
 * se crean las que el conjunto declara: una suite que pide otra falla al no encontrar la cuenta.
 */
export const FIXED_ACCOUNTS: Record<FixedAccountKey, FixedAccountSpec> =
  armarConjunto(conjuntoActivo())

/** Las cuentas del conjunto activo, en orden estable. */
export const FIXED_ACCOUNT_LIST: readonly FixedAccountSpec[] =
  cuentasDelConjunto()

/** Nombre completo como se ve en las pantallas (`first_name last_name`). */
export function fullName(spec: FixedAccountSpec): string {
  return `${spec.firstName} ${spec.lastName}`
}

/** Nombre completo de la cuenta fija `key` del conjunto activo (para pantallas y búsquedas). */
export function nombreDe(key: FixedAccountKey): string {
  return fullName(FIXED_ACCOUNTS[key])
}

/** Expresión regular que acepta ese nombre completo y no uno más largo (por ejemplo `Empleado1`). */
export function reNombreDe(key: FixedAccountKey): RegExp {
  const escapado = nombreDe(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escapado}(?![\\w-])`)
}

/** Prefijo de email propio del conjunto activo (para contar o reconocer sus cuentas). */
export function prefijoEmailDelConjunto(): string {
  const { tag } = DEF_CONJUNTOS[conjuntoActivo()]
  return `e2e-fijo-${tag ? `${tag}-` : ''}`
}

/** `true` si el email es de una cuenta fija del conjunto activo (y no de otro conjunto). */
export function esDelConjuntoActivo(email: string): boolean {
  const e = email.toLowerCase()
  if (!e.startsWith(prefijoEmailDelConjunto())) return false
  if (conjuntoActivo() !== 'base') return true
  // En el base, "e2e-fijo-" también empieza el email de los otros conjuntos: se los descarta.
  return !Object.values(DEF_CONJUNTOS).some(
    (d) => d.tag && e.startsWith(`e2e-fijo-${d.tag}-`),
  )
}

/** Email de la cuenta descartable del test de baja con la app abierta (CB-18), por conjunto. */
export function emailBajaCb18(): string {
  const { tag } = DEF_CONJUNTOS[conjuntoActivo()]
  return `e2e-baja-cb18${tag ? `-${tag}` : ''}@${DOMAIN}`
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
export async function loadAuthUsers(db: AdminDb): Promise<Map<string, User>> {
  const perPage = 1000
  const byEmail = new Map<string, User>()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`No se pudo listar usuarios: ${error.message}`)
    for (const user of data.users) {
      if (user.email) byEmail.set(user.email.toLowerCase(), user)
    }
    if (data.users.length < perPage) break
  }
  return byEmail
}

/** Ids de Auth por email en minúscula. */
export async function loadAuthUserIds(
  db: AdminDb,
): Promise<Map<string, string>> {
  const users = await loadAuthUsers(db)
  return new Map([...users].map(([email, user]) => [email, user.id]))
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

export interface EnsureOptions {
  /**
   * `true` (por omisión, para el setup y el global setup): repone también lo que los tests
   * mueven (capacidades de los administradores y estado de la ficha). `false`: solo crea lo que
   * falte y repara perfil y roles; no pisa capacidades, así es seguro llamarlo EN MEDIO de una
   * corrida con otros tests en paralelo.
   */
  restore?: boolean
  /**
   * `true`: repone la contraseña de todas las cuentas. OJO: cambiar la contraseña en Auth cierra
   * las sesiones de esa cuenta, y los `storageState` de la corrida quedan inservibles. Por eso
   * por omisión la contraseña solo se repone si la cuenta está baneada o sin confirmar.
   */
  forcePassword?: boolean
  /** Conjunto a reponer (por omisión, el activo). `setup-accounts.ts` los recorre todos. */
  conjunto?: Conjunto
}

/**
 * Crea las cuentas fijas que falten y deja TODAS activas y completas. Idempotente: las que ya
 * existen se reutilizan (perfil, roles, capacidades y ficha se reponen según `options`).
 */
export async function ensureFixedAccounts(
  db: AdminDb = getAdminDb(),
  options: EnsureOptions = {},
): Promise<EnsureResult> {
  const restore = options.restore ?? true
  const lista = cuentasDelConjunto(options.conjunto)
  const env = requireE2eEnv()
  const result: EnsureResult = { created: [], existing: [], ids: {} }
  const authUsers = await loadAuthUsers(db)

  for (const spec of lista) {
    const existingUser = authUsers.get(spec.email.toLowerCase())
    let userId = existingUser?.id ?? null

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
      const banned =
        !!existingUser?.banned_until &&
        new Date(existingUser.banned_until).getTime() > Date.now()
      const unconfirmed = !existingUser?.email_confirmed_at
      if (options.forcePassword || banned || unconfirmed) {
        const { error } = await db.auth.admin.updateUserById(userId, {
          password: env.seedPassword,
          email_confirm: true,
          ban_duration: 'none',
          user_metadata: {
            first_name: spec.firstName,
            last_name: spec.lastName,
          },
        })
        if (error) {
          throw new Error(
            `No se pudo reponer la cuenta fija ${spec.email}: ${error.message}`,
          )
        }
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
          { onConflict: 'profile_id,capability', ignoreDuplicates: !restore },
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
      if (row && restore) {
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
      } else if (!row) {
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
