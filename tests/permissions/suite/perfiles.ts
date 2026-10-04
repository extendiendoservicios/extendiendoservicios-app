// tests/permissions/suite/perfiles.ts — TEST-019 (P18.3)
//
// Los siete perfiles de la matriz de permisos (`03_Plan_Maestro_Tecnico.md` sección 6) y las
// cuentas fijas que los encarnan (`tests/fixtures/accounts.ts`, decisión de Mike del 3 oct 2026).
// Los tests nunca nombran emails: piden el perfil por su clave.

import { FIXED_ACCOUNTS, OWNER_EMAIL } from '../../fixtures/accounts.ts'

/** Perfiles de la matriz. `anon` es el visitante sin sesión (clave publicable). */
export const PERFILES = [
  'anon',
  'empleado',
  'supervisor',
  'dual',
  'adminSin',
  'admin',
  'owner',
] as const
export type Perfil = (typeof PERFILES)[number]

/** Perfiles con sesión (todos menos `anon`). */
export const PERFILES_CON_SESION = PERFILES.filter(
  (p): p is Exclude<Perfil, 'anon'> => p !== 'anon',
)
export type PerfilConSesion = (typeof PERFILES_CON_SESION)[number]

/** Cómo se llama cada perfil en los títulos de los tests. */
export const ETIQUETA: Record<Perfil, string> = {
  anon: 'anon',
  empleado: 'empleado',
  supervisor: 'supervisor',
  dual: 'doble rol',
  adminSin: 'admin sin capacidades',
  admin: 'admin con todas',
  owner: 'dueño',
}

/** Email de la cuenta que encarna a cada perfil con sesión. */
export const EMAIL_DE: Record<PerfilConSesion, string> = {
  empleado: FIXED_ACCOUNTS.empleado1.email,
  supervisor: FIXED_ACCOUNTS.supervisor1.email,
  dual: FIXED_ACCOUNTS.dual.email,
  adminSin: FIXED_ACCOUNTS.adminSinCapacidades.email,
  admin: FIXED_ACCOUNTS.admin.email,
  owner: OWNER_EMAIL,
}

/** Perfiles que pasan por `app.is_admin()` (administrador o dueño). */
export const ES_ADMIN: readonly Perfil[] = ['adminSin', 'admin', 'owner']

/** Perfiles que, además, tienen todas las capacidades (el dueño siempre, el admin con las siete). */
export const CON_CAPACIDADES: readonly Perfil[] = ['admin', 'owner']

/** Todos los perfiles con sesión. */
export const AUTENTICADOS: readonly Perfil[] = PERFILES_CON_SESION
