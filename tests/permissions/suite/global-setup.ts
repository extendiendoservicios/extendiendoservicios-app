// tests/permissions/suite/global-setup.ts — TEST-019 (P18.3)
//
// Se ejecuta UNA vez antes de todos los archivos de la matriz:
//   1. Deja las cuentas fijas completas (`ensureFixedAccounts`, SIN `forcePassword`: cambiar la
//      contraseña por la Admin API cierra todas las sesiones de la cuenta).
//   2. Resuelve los ids UNA sola vez (la intermitencia de P04.7 venía de repetir `listUsers`
//      dentro de cada caso con varios archivos en paralelo).
//   3. Inicia sesión una sola vez por perfil (y una más para el administrador que cambia de
//      capacidades) y reparte los tokens.
//   4. Planta el escenario `e2e-perm-` y, al terminar, lo borra y repone lo que la suite toca.

import type { TestProject } from 'vitest/node'
import { createClient } from '@supabase/supabase-js'
import {
  ensureFixedAccounts,
  getAdminDb,
  loadAuthUserIds,
  OWNER_EMAIL,
} from '../../fixtures/accounts.ts'
import { daysFromToday } from '../../fixtures/dates.ts'
import { readE2eEnv, requireE2eEnv } from '../../fixtures/env.ts'
import type { Database } from '../../../src/lib/database.types.ts'
import type { Contexto, IdsCuentas } from './contexto.ts'
import { barrerResiduos, limpiar, plantar } from './escenario.ts'
import { EMAIL_DE, PERFILES_CON_SESION } from './perfiles.ts'

async function iniciarSesion(email: string) {
  const env = requireE2eEnv()
  const cliente = createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await cliente.auth.signInWithPassword({
    email,
    password: env.seedPassword,
  })
  if (error || !data.session) {
    throw new Error(
      `No se pudo iniciar sesión como ${email}: ${error?.message ?? 'sin sesión'}. ` +
        'No se repone la contraseña en plena corrida (cerraría las sesiones de la cuenta): ' +
        'corré `pnpm test:fixtures:setup` y reintentá.',
    )
  }
  return { cliente, sesion: data.session }
}

export default async function setup(project: TestProject) {
  if (!readE2eEnv()) {
    console.warn(
      '[permisos] Faltan variables en .env.local: la matriz se saltea sola.',
    )
    return
  }

  const db = getAdminDb()
  await ensureFixedAccounts(db)
  const authIds = await loadAuthUserIds(db)
  const ownerId = authIds.get(OWNER_EMAIL.toLowerCase())
  if (!ownerId) throw new Error('No existe el dueño del seed en App_dev.')

  const idDeEmail = (email: string): string => {
    const id = authIds.get(email.toLowerCase())
    if (!id)
      throw new Error(
        `No existe la cuenta ${email}: corré pnpm test:fixtures:setup.`,
      )
    return id
  }
  const ids: IdsCuentas = {
    owner: ownerId,
    admin: idDeEmail('e2e-fijo-admin@example.com'),
    adminSin: idDeEmail('e2e-fijo-admin-sin-capacidades@example.com'),
    adminCapacidades: idDeEmail('e2e-fijo-admin-capacidades@example.com'),
    empleado1: idDeEmail('e2e-fijo-empleado-1@example.com'),
    empleado2: idDeEmail('e2e-fijo-empleado-2@example.com'),
    empleado3: idDeEmail('e2e-fijo-empleado-3@example.com'),
    empleado4: idDeEmail('e2e-fijo-empleado-4@example.com'),
    supervisor1: idDeEmail('e2e-fijo-supervisor-1@example.com'),
    supervisor2: idDeEmail('e2e-fijo-supervisor-2@example.com'),
    dual: idDeEmail('e2e-fijo-dual@example.com'),
  }

  // Un inicio de sesión por perfil, más el del administrador de capacidades.
  const tokens = {} as Contexto['tokens']
  let refreshEmpleado = ''
  let owner: Awaited<ReturnType<typeof iniciarSesion>> | null = null
  for (const perfil of PERFILES_CON_SESION) {
    const s = await iniciarSesion(EMAIL_DE[perfil])
    tokens[perfil] = s.sesion.access_token
    if (perfil === 'empleado') refreshEmpleado = s.sesion.refresh_token
    if (perfil === 'owner') owner = s
  }
  const capacidades = await iniciarSesion(
    'e2e-fijo-admin-capacidades@example.com',
  )
  tokens.adminCapacidades = capacidades.sesion.access_token
  if (!owner) throw new Error('Sin sesión del dueño.')

  // Instantánea de lo que la suite puede tocar (se repone al final).
  const { data: perfilesAntes } = await db
    .from('profiles')
    .select('id, phone, contact_email')
    .in('id', Object.values(ids))
  const { data: empresaAntes } = await db
    .from('company_settings')
    .select('*')
    .eq('id', 1)
    .single()

  await barrerResiduos(db)
  const fechaTurno = daysFromToday(3)
  const e = await plantar(db, owner.cliente, ids, fechaTurno)

  const ctx: Contexto = {
    ids,
    e,
    tokens,
    refreshAdminCapacidades: capacidades.sesion.refresh_token,
    refreshEmpleado,
    fechaTurno,
  }
  project.provide('permisos', ctx)

  return async () => {
    const dbFinal = getAdminDb()
    // Siempre activas y con sus capacidades de origen, pase lo que pase en la corrida.
    await ensureFixedAccounts(dbFinal)
    const notas = await limpiar(dbFinal, e)
    for (const p of perfilesAntes ?? []) {
      await dbFinal
        .from('profiles')
        .update({ phone: p.phone, contact_email: p.contact_email })
        .eq('id', p.id)
    }
    if (empresaAntes) {
      await dbFinal.from('company_settings').update(empresaAntes).eq('id', 1)
    }
    await barrerResiduos(dbFinal)
    if (notas.length > 0) {
      console.warn(`[permisos] limpieza con notas: ${notas.join(' | ')}`)
    }
  }
}
