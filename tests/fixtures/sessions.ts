// tests/fixtures/sessions.ts — TEST-015/TEST-016 (P18.1)
//
// Sesiones de las cuentas fijas SIN pasar por la pantalla de ingreso en cada test:
//  - `storageStatePath(key)`: archivo de `storageState` de Playwright que arma el global setup
//    (`global-setup.ts`) con una sola sesión por cuenta y por corrida. Así una suite de ~40
//    tests no gasta ~40 inicios de sesión (el proveedor limita los ingresos por IP) y cada test
//    arranca ya adentro. El ingreso por pantalla se sigue probando en `tests/e2e-auth/` y en
//    `acceso.admin.ts`.
//  - `signedClient(email)`: cliente `supabase-js` con la sesión de esa cuenta, para las RPC y
//    las pruebas por API directa (RLS y permisos reales, no la clave de servicio).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type Session } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types.ts'
import { authStorageKey, E2E_BASE_URL, requireE2eEnv } from './env.ts'
import {
  conjuntoActivo,
  FIXED_ACCOUNTS,
  OWNER_EMAIL,
  type AdminDb,
  type FixedAccountKey,
} from './accounts.ts'

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Carpeta del estado de la corrida. Dentro de `node_modules/.cache/` porque git la ignora y
 * Playwright no la limpia al arrancar (a diferencia de `test-results/`). Cada conjunto de cuentas
 * (`E2E_CONJUNTO`, ver `accounts.ts`) tiene su carpeta: dos suites en paralelo en la misma
 * máquina no se pisan los `storageState`.
 */
export const STATE_DIR = path.join(
  APP_ROOT,
  'node_modules',
  '.cache',
  conjuntoActivo() === 'base' ? 'e2e-fijo' : `e2e-fijo-${conjuntoActivo()}`,
)

export type SessionKey = FixedAccountKey | 'owner'

export function emailOf(key: SessionKey): string {
  return key === 'owner' ? OWNER_EMAIL : FIXED_ACCOUNTS[key].email
}

export function storageStatePath(key: SessionKey): string {
  return path.join(STATE_DIR, `estado-${key}.json`)
}

export function idsFilePath(): string {
  return path.join(STATE_DIR, 'ids.json')
}

/** Cliente de `supabase-js` con la clave pública y sin persistencia (RLS y permisos reales). */
export function anonClient(): AdminDb {
  const env = requireE2eEnv()
  return createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Inicia sesión por API y devuelve la sesión (para `storageState` o para pedidos directos). */
export async function signInSession(email: string): Promise<Session> {
  const env = requireE2eEnv()
  const { data, error } = await anonClient().auth.signInWithPassword({
    email,
    password: env.seedPassword,
  })
  if (error || !data.session) {
    throw new Error(
      `No se pudo iniciar sesión como ${email}: ${error?.message ?? 'sin sesión'}`,
    )
  }
  return data.session
}

/** Cliente con la sesión de la cuenta indicada (el dueño del seed o una cuenta fija). */
export async function signedClient(key: SessionKey): Promise<AdminDb> {
  const session = await signInSession(emailOf(key))
  const client = anonClient()
  const { error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (error) throw new Error(`setSession de ${key}: ${error.message}`)
  return client
}

/** `storageState` de Playwright con la sesión ya iniciada en `localStorage` (sin archivo). */
export function buildStorageState(session: Session): {
  cookies: []
  origins: Array<{
    origin: string
    localStorage: Array<{ name: string; value: string }>
  }>
} {
  const env = requireE2eEnv()
  return {
    cookies: [],
    origins: [
      {
        origin: E2E_BASE_URL,
        localStorage: [
          {
            name: authStorageKey(env.supabaseUrl),
            value: JSON.stringify(session),
          },
        ],
      },
    ],
  }
}

/** Sesión nueva (claims frescos: roles y capacidades de ESTE momento) lista para un contexto. */
export async function freshStorageState(
  key: SessionKey,
): Promise<ReturnType<typeof buildStorageState>> {
  return buildStorageState(await signInSession(emailOf(key)))
}

/** Escribe el `storageState` de Playwright con la sesión ya iniciada en `localStorage`. */
export function writeStorageState(key: SessionKey, session: Session): void {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(
    storageStatePath(key),
    JSON.stringify(buildStorageState(session)),
  )
}

export function writeIds(ids: Record<string, string>): void {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(idsFilePath(), JSON.stringify(ids))
}

/** Id (profile_id) de una cuenta fija, leído del archivo que dejó el global setup. */
export function readId(key: SessionKey): string {
  const ids = JSON.parse(readFileSync(idsFilePath(), 'utf8')) as Record<
    string,
    string
  >
  const id = ids[key]
  if (!id) {
    throw new Error(
      `No hay id para "${key}": el global setup no corrió (tests/fixtures/global-setup.ts).`,
    )
  }
  return id
}
