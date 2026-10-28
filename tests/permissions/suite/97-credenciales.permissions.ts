// tests/permissions/suite/97-credenciales.permissions.ts — P26.4 (módulo P26, CR-02, CR-07, CR-08,
// CR-10, CR-13)
//
// Credenciales visibles, por API directa contra la Edge Function `admin-users` desplegada en
// App_dev y contra PostgREST:
//   1. `get_credentials` y `get_access_status`: cada actor contra cada objetivo (quién ve a quién).
//   2. `change_own_password`: cada rol cambia la suya; el dueño ve la nueva con `source =
//      self_change`; la persona inicia sesión con ella; menos de 8 caracteres es VALIDATION_ERROR.
//   3. La tabla `account_credentials` no se lee ni se escribe por PostgREST (anon ni ningún rol).
//   4. `reset_password` del administrador deja la copia con `source = admin_reset`.
//
// Cambiar una contraseña por la función hace que GoTrue cierre las OTRAS sesiones de la persona, y
// los siete perfiles de la matriz comparten tokens entre archivos. Por eso esta suite NO cambia la
// contraseña de las cuentas fijas: usa cinco cuentas propias, una por rol (`e2e-p26-<rol>`), que
// crea la primera vez con `create_user` y reutiliza después (no hay cómo borrarlas, P-014).
// Las contraseñas se restauran SIEMPRE a la del seed (`finally` en cada caso, y una red de
// seguridad en `afterAll`) y la fila de la copia vuelve exactamente a como estaba.

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getAdminDb, loadAuthUserIds } from '../../fixtures/accounts.ts'
import { readE2eEnv, requireE2eEnv } from '../../fixtures/env.ts'
import { esLimiteDeTasa } from '../../fixtures/sessions.ts'
import { denegado, describir, tabla } from './ayudas.ts'
import { clienteDe, contexto, servicio, tokenVigente } from './contexto.ts'
import { llamarEdge } from './edge-cliente.ts'
import {
  ETIQUETA,
  PERFILES,
  PERFILES_CON_SESION,
  type Perfil,
  type PerfilConSesion,
} from './perfiles.ts'

type ClaveId = keyof ReturnType<typeof contexto>['ids']

/** Id de cada perfil en las cuentas fijas (el empleado y el supervisor son los "1"). */
const CLAVE_ID: Record<PerfilConSesion, ClaveId> = {
  empleado: 'empleado1',
  supervisor: 'supervisor1',
  dual: 'dual',
  adminSin: 'adminSin',
  admin: 'admin',
  owner: 'owner',
}

const OBJETIVOS = PERFILES_CON_SESION

/** CR-02, CR-07, CR-08: el dueño ve a todos; el admin con `manage_users` solo a empleados y supervisores. */
function permitido(actor: Perfil, objetivo: PerfilConSesion): boolean {
  if (actor === 'owner') return true
  if (actor === 'admin') {
    return (
      objetivo === 'empleado' ||
      objetivo === 'supervisor' ||
      objetivo === 'dual'
    )
  }
  return false
}

const ACCIONES_LECTURA = ['get_credentials', 'get_access_status'] as const

// Cuentas propias de la suite, una por rol (las únicas cuya contraseña se cambia).
const TEMP = {
  empleado: { roles: ['employee'], dni: '99260001' },
  supervisor: { roles: ['supervisor'], dni: '99260002' },
  dual: { roles: ['employee', 'supervisor'], dni: '99260003' },
  admin: { roles: ['admin'], dni: null },
  owner: { roles: ['owner'], dni: null },
} as const
type ClaveTemp = keyof typeof TEMP
const idsTemp = {} as Record<ClaveTemp, string>
const emailTemp = (c: ClaveTemp): string => `e2e-p26-${c}@example.com`

type FilaCopia = Record<string, unknown>
const instantanea = new Map<string, FilaCopia | null>()
const desde = new Date(Date.now() - 60_000).toISOString()
const sufijo = Math.random().toString(36).slice(2, 10)

function idsToqueteados(): string[] {
  return Object.values(idsTemp)
}

async function contarEventos(
  tipo: 'credentials_viewed' | 'password_changed_by_user',
  actor: string,
  objetivo: string | null,
): Promise<number> {
  let q = servicio()
    .from('security_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', tipo)
    .eq('actor_id', actor)
  if (objetivo) q = q.eq('target_id', objetivo)
  const { count, error } = await q
  expect(error?.message).toBeUndefined()
  return count ?? 0
}

async function iniciarSesion(email: string, password: string) {
  const env = requireE2eEnv()
  const cliente = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let res = await cliente.auth.signInWithPassword({ email, password })
  for (const espera of [5, 10, 20, 30]) {
    if (!res.error || !esLimiteDeTasa(res.error)) break
    await new Promise((r) => setTimeout(r, espera * 1000))
    res = await cliente.auth.signInWithPassword({ email, password })
  }
  return res
}

async function copiaDe(id: string): Promise<FilaCopia | null> {
  const { data, error } = await servicio()
    .from('account_credentials')
    .select('*')
    .eq('profile_id', id)
    .maybeSingle()
  expect(error?.message).toBeUndefined()
  return data ?? null
}

/** Crea las cinco cuentas propias la primera vez (con la contraseña del seed). */
async function asegurarCuentasTemp(): Promise<void> {
  const env = requireE2eEnv()
  const existentes = await loadAuthUserIds(getAdminDb())
  const tokenDueno = await tokenVigente('owner')
  for (const clave of Object.keys(TEMP) as ClaveTemp[]) {
    let id = existentes.get(emailTemp(clave))
    if (!id) {
      const t = TEMP[clave]
      const r = await llamarEdge(tokenDueno, {
        action: 'create_user',
        email: emailTemp(clave),
        password: env.seedPassword,
        first_name: 'E2E-P26',
        last_name: clave,
        roles: t.roles,
        phone: null,
        ...(t.dni ? { employee: { dni: t.dni } } : {}),
      })
      expect(
        r.hint,
        `alta de ${emailTemp(clave)}: ${JSON.stringify(r.cuerpo)}`,
      ).toBe('OK')
      id = (r.cuerpo as { data: { profile_id: string } }).data.profile_id
    }
    idsTemp[clave] = id
  }
}

/** Vuelve a la contraseña del seed con la función, entrando con la que quedó puesta. */
async function restaurar(email: string, actual: string): Promise<void> {
  const env = requireE2eEnv()
  const s = await iniciarSesion(email, actual)
  const rest = await llamarEdge(s.data.session?.access_token ?? null, {
    action: 'change_own_password',
    new_password: env.seedPassword,
    origin: 'profile',
  })
  expect(rest.hint, `restauración: ${JSON.stringify(rest.cuerpo)}`).toBe('OK')
}

beforeAll(async () => {
  if (!readE2eEnv()) return
  await asegurarCuentasTemp()
  for (const id of idsToqueteados()) instantanea.set(id, await copiaDe(id))
})

afterAll(async () => {
  if (!readE2eEnv() || Object.keys(idsTemp).length === 0) return
  const db = servicio()
  const env = requireE2eEnv()
  // Red de seguridad: si algún caso se cortó antes de restaurar, la contraseña vuelve al seed.
  for (const clave of Object.keys(TEMP) as ClaveTemp[]) {
    await db.auth.admin.updateUserById(idsTemp[clave], {
      password: env.seedPassword,
    })
  }
  // La fila de la copia vuelve exactamente a como estaba.
  for (const [id, fila] of instantanea) {
    if (fila) {
      await db.from('account_credentials').upsert(fila as never)
    } else {
      await db.from('account_credentials').delete().eq('profile_id', id)
    }
  }
  // Se borran solo los eventos de esta corrida que hicieron o recibieron las cuentas propias.
  const tipos = [
    'credentials_viewed',
    'password_changed_by_user',
    'password_reset_by_admin',
  ] as const
  await db
    .from('security_events')
    .delete()
    .in('event_type', [...tipos])
    .in('target_id', idsToqueteados())
    .gte('created_at', desde)
  const { ids } = contexto()
  await db
    .from('security_events')
    .delete()
    .eq('event_type', 'credentials_viewed')
    .in('actor_id', [ids.owner, ids.admin, ids.adminSin])
    .gte('created_at', desde)
})

describe('get_credentials y get_access_status: quién ve a quién (CR-02, CR-07, CR-08)', () => {
  for (const accion of ACCIONES_LECTURA) {
    describe(accion, () => {
      for (const actor of PERFILES) {
        if (actor === 'anon') continue
        for (const objetivo of OBJETIVOS) {
          const esperado = permitido(actor, objetivo) ? 'OK' : 'FORBIDDEN'
          it(`[${ETIQUETA[actor]}] ${accion} sobre ${ETIQUETA[objetivo]} -> ${esperado} (CR-02, CR-07, CR-08)`, async () => {
            const token = await tokenVigente(actor)
            const r = await llamarEdge(token, {
              action: accion,
              profile_id: contexto().ids[CLAVE_ID[objetivo]],
            })
            expect(r.hint, JSON.stringify(r.cuerpo)).toBe(esperado)
            expect(r.status).toBe(esperado === 'OK' ? 200 : 403)
          })
        }
      }

      it(`[anon] ${accion} con la clave publicable como Bearer -> 401 UNAUTHENTICATED`, async () => {
        const r = await llamarEdge(requireE2eEnv().anonKey, {
          action: accion,
          profile_id: contexto().ids.empleado1,
        })
        expect(r.status).toBe(401)
        expect(r.hint).toBe('UNAUTHENTICATED')
      })

      it(`[sin sesión] ${accion} sin Authorization -> 401`, async () => {
        const r = await llamarEdge(null, {
          action: accion,
          profile_id: contexto().ids.empleado1,
        })
        expect(r.status).toBe(401)
      })
    })
  }

  it('get_access_status nunca trae password, ciphertext ni iv y no deja credentials_viewed (CR-10)', async () => {
    const { ids } = contexto()
    const token = await tokenVigente('owner')
    for (const objetivo of OBJETIVOS) {
      const id = ids[CLAVE_ID[objetivo]]
      const antes = await contarEventos('credentials_viewed', ids.owner, id)
      const r = await llamarEdge(token, {
        action: 'get_access_status',
        profile_id: id,
      })
      expect(r.hint, JSON.stringify(r.cuerpo)).toBe('OK')
      const texto = JSON.stringify(r.cuerpo)
      expect(texto, objetivo).not.toMatch(/"password"|"ciphertext"|"iv"/)
      expect(await contarEventos('credentials_viewed', ids.owner, id)).toBe(
        antes,
      )
    }
  })

  it('get_credentials deja un evento credentials_viewed por pedido, con quién y a quién (CR-10)', async () => {
    const { ids } = contexto()
    const token = await tokenVigente('admin')
    const antes = await contarEventos(
      'credentials_viewed',
      ids.admin,
      ids.empleado1,
    )
    for (let i = 0; i < 2; i++) {
      const r = await llamarEdge(token, {
        action: 'get_credentials',
        profile_id: ids.empleado1,
      })
      expect(r.hint, JSON.stringify(r.cuerpo)).toBe('OK')
    }
    expect(
      await contarEventos('credentials_viewed', ids.admin, ids.empleado1),
    ).toBe(antes + 2)
  })

  it('un get_credentials rechazado no deja credentials_viewed (CR-02)', async () => {
    const { ids } = contexto()
    const antes = await contarEventos(
      'credentials_viewed',
      ids.admin,
      ids.owner,
    )
    const r = await llamarEdge(await tokenVigente('admin'), {
      action: 'get_credentials',
      profile_id: ids.owner,
    })
    expect(r.hint).toBe('FORBIDDEN')
    expect(
      await contarEventos('credentials_viewed', ids.admin, ids.owner),
    ).toBe(antes)
  })

  it('get_credentials sin profile_id -> VALIDATION_ERROR', async () => {
    const r = await llamarEdge(await tokenVigente('owner'), {
      action: 'get_credentials',
    })
    expect(r.hint).toBe('VALIDATION_ERROR')
  })
})

describe('change_own_password (CR-04, CR-13)', () => {
  for (const clave of Object.keys(TEMP) as ClaveTemp[]) {
    it(`[${clave}] cambia la suya (origin profile); el dueño ve la nueva con source self_change y la persona entra con ella (CR-04, CR-11)`, async () => {
      const env = requireE2eEnv()
      const id = idsTemp[clave]
      const email = emailTemp(clave)
      const nueva = `P26-4-${clave}-${sufijo}`
      const eventosAntes = await contarEventos(
        'password_changed_by_user',
        id,
        null,
      )
      let cambiada = false
      try {
        const s0 = await iniciarSesion(email, env.seedPassword)
        expect(s0.error?.message).toBeUndefined()
        const r = await llamarEdge(s0.data.session?.access_token ?? null, {
          action: 'change_own_password',
          new_password: nueva,
          origin: 'profile',
        })
        expect(r.hint, JSON.stringify(r.cuerpo)).toBe('OK')
        expect(r.status).toBe(200)
        cambiada = true
        expect(await contarEventos('password_changed_by_user', id, null)).toBe(
          eventosAntes + 1,
        )

        // El dueño ve la contraseña nueva.
        const v = await llamarEdge(await tokenVigente('owner'), {
          action: 'get_credentials',
          profile_id: id,
        })
        expect(v.hint, JSON.stringify(v.cuerpo)).toBe('OK')
        const datos = (v.cuerpo as { data: Record<string, unknown> }).data
        expect(datos.password).toBe(nueva)
        expect(datos.source).toBe('self_change')
        expect(datos.status).toBe('ok')

        // Y la persona inicia sesión con la nueva (y no con la vieja).
        const conNueva = await iniciarSesion(email, nueva)
        expect(conNueva.error?.message).toBeUndefined()
        expect(conNueva.data.session).not.toBeNull()
        const conVieja = await iniciarSesion(email, env.seedPassword)
        expect(conVieja.data.session).toBeNull()
      } finally {
        if (cambiada) await restaurar(email, nueva)
      }
      const vuelta = await iniciarSesion(email, env.seedPassword)
      expect(
        vuelta.error?.message,
        'la contraseña original tiene que andar',
      ).toBeUndefined()
    })
  }

  // DEF-P26-01 (corregido en P26.1c): la función cambia la contraseña con el JWT de la persona
  // (PUT /auth/v1/user), así que la sesión que hace el cambio sigue viva. Antes usaba la Admin
  // API, que cierra todas las sesiones, incluida la propia.
  it('DEF-P26-01 · la sesión que hizo el cambio sigue viva y puede volver a llamar a la función (CR-13)', async () => {
    const env = requireE2eEnv()
    const email = emailTemp('empleado')
    const nueva = `P26-4-sesion-propia-${sufijo}`
    let cambiada = false
    try {
      const a = await iniciarSesion(email, env.seedPassword)
      const token = a.data.session?.access_token ?? null
      const r = await llamarEdge(token, {
        action: 'change_own_password',
        new_password: nueva,
        origin: 'profile',
      })
      expect(r.hint, JSON.stringify(r.cuerpo)).toBe('OK')
      cambiada = true
      // El rechazo del cuerpo (400) llega después de la autenticación: la sesión está viva.
      const otra = await llamarEdge(token, {
        action: 'change_own_password',
        new_password: 'x',
        origin: 'profile',
      })
      expect(otra.status, 'la sesión que hizo el cambio quedó cerrada').toBe(
        400,
      )
    } finally {
      if (cambiada) await restaurar(email, nueva)
    }
  })

  // Las OTRAS sesiones de la cuenta las cierra GoTrue al cambiar la contraseña, por cualquier
  // camino (probado contra el Auth hospedado). Es el mismo comportamiento que había antes de
  // P26.3, cuando el front llamaba a `auth.updateUser`. CR-13 conserva esa regla.
  it('GoTrue cierra las otras sesiones de la cuenta al cambiar la contraseña (comportamiento de Auth, igual que antes de P26.3)', async () => {
    const env = requireE2eEnv()
    const email = emailTemp('empleado')
    const nueva = `P26-4-otras-sesiones-${sufijo}`
    let cambiada = false
    try {
      const a = await iniciarSesion(email, env.seedPassword)
      const b = await iniciarSesion(email, env.seedPassword)
      const r = await llamarEdge(a.data.session?.access_token ?? null, {
        action: 'change_own_password',
        new_password: nueva,
        origin: 'profile',
      })
      expect(r.hint, JSON.stringify(r.cuerpo)).toBe('OK')
      cambiada = true
      const otra = await llamarEdge(b.data.session?.access_token ?? null, {
        action: 'change_own_password',
        new_password: 'x',
        origin: 'profile',
      })
      expect([401, 403]).toContain(otra.status)
    } finally {
      if (cambiada) await restaurar(email, nueva)
    }
  })

  it('[empleado] contraseña de menos de 8 caracteres -> VALIDATION_ERROR y la contraseña no cambia (CR-13)', async () => {
    const env = requireE2eEnv()
    const s = await iniciarSesion(emailTemp('empleado'), env.seedPassword)
    const r = await llamarEdge(s.data.session?.access_token ?? null, {
      action: 'change_own_password',
      new_password: 'corta12',
      origin: 'profile',
    })
    expect(r.hint).toBe('VALIDATION_ERROR')
    expect(r.status).toBe(400)
    const despues = await iniciarSesion(emailTemp('empleado'), env.seedPassword)
    expect(despues.error?.message).toBeUndefined()
  })

  it('[empleado] origin inválido -> VALIDATION_ERROR y la contraseña no cambia', async () => {
    const env = requireE2eEnv()
    const s = await iniciarSesion(emailTemp('empleado'), env.seedPassword)
    const r = await llamarEdge(s.data.session?.access_token ?? null, {
      action: 'change_own_password',
      new_password: `P26-4-origen-${sufijo}`,
      origin: 'admin',
    })
    expect(r.hint).toBe('VALIDATION_ERROR')
    const despues = await iniciarSesion(emailTemp('empleado'), env.seedPassword)
    expect(despues.error?.message).toBeUndefined()
  })

  it('[anon] change_own_password con la clave publicable -> 401 UNAUTHENTICATED', async () => {
    const r = await llamarEdge(requireE2eEnv().anonKey, {
      action: 'change_own_password',
      new_password: `P26-4-anon-${sufijo}`,
      origin: 'profile',
    })
    expect(r.status).toBe(401)
    expect(r.hint).toBe('UNAUTHENTICATED')
  })

  it('[sin sesión] change_own_password sin Authorization -> 401', async () => {
    const r = await llamarEdge(null, {
      action: 'change_own_password',
      new_password: `P26-4-sin-${sufijo}`,
      origin: 'profile',
    })
    expect(r.status).toBe(401)
  })

  it('change_own_password cambia solo la cuenta del token (ignora un profile_id ajeno)', async () => {
    const env = requireE2eEnv()
    const email = emailTemp('empleado')
    const nueva = `P26-4-ajena-${sufijo}`
    let cambiada = false
    try {
      const s = await iniciarSesion(email, env.seedPassword)
      const r = await llamarEdge(s.data.session?.access_token ?? null, {
        action: 'change_own_password',
        new_password: nueva,
        origin: 'profile',
        profile_id: idsTemp.owner,
      })
      expect(r.hint, JSON.stringify(r.cuerpo)).toBe('OK')
      cambiada = true
      const duenio = await iniciarSesion(emailTemp('owner'), env.seedPassword)
      expect(duenio.error?.message, 'la ajena no se toca').toBeUndefined()
    } finally {
      if (cambiada) await restaurar(email, nueva)
    }
  })
})

describe('reset_password del administrador (CR-04, CR-11)', () => {
  it('[admin con todas] resetea a un empleado y la copia queda con source admin_reset; se restaura la original', async () => {
    const env = requireE2eEnv()
    const id = idsTemp.empleado
    const email = emailTemp('empleado')
    const nueva = `P26-4-reset-${sufijo}`
    let reseteada = false
    try {
      const r = await llamarEdge(await tokenVigente('admin'), {
        action: 'reset_password',
        profile_id: id,
        new_password: nueva,
      })
      expect(r.hint, JSON.stringify(r.cuerpo)).toBe('OK')
      reseteada = true

      const v = await llamarEdge(await tokenVigente('owner'), {
        action: 'get_credentials',
        profile_id: id,
      })
      expect(v.hint, JSON.stringify(v.cuerpo)).toBe('OK')
      const datos = (v.cuerpo as { data: Record<string, unknown> }).data
      expect(datos.password).toBe(nueva)
      expect(datos.source).toBe('admin_reset')

      // Verificada también por la fila, sin descifrar: set_by es quien reseteó.
      const fila = await copiaDe(id)
      expect(fila?.source).toBe('admin_reset')
      expect(fila?.set_by).toBe(contexto().ids.admin)

      const s = await iniciarSesion(email, nueva)
      expect(s.error?.message).toBeUndefined()
    } finally {
      if (reseteada) {
        const rest = await llamarEdge(await tokenVigente('owner'), {
          action: 'reset_password',
          profile_id: id,
          new_password: env.seedPassword,
        })
        expect(rest.hint, `restauración: ${JSON.stringify(rest.cuerpo)}`).toBe(
          'OK',
        )
      }
    }
    const vuelta = await iniciarSesion(email, env.seedPassword)
    expect(
      vuelta.error?.message,
      'la contraseña original tiene que andar',
    ).toBeUndefined()
  })

  it('[admin sin capacidades] reset_password sobre un empleado -> FORBIDDEN y no cambia nada (CR-08)', async () => {
    const id = idsTemp.empleado
    const antes = await copiaDe(id)
    const r = await llamarEdge(await tokenVigente('adminSin'), {
      action: 'reset_password',
      profile_id: id,
      new_password: `P26-4-sinCap-${sufijo}`,
    })
    expect(r.hint).toBe('FORBIDDEN')
    expect(await copiaDe(id)).toEqual(antes)
  })
})

describe('tabla account_credentials por PostgREST (CR-09, 0075)', () => {
  const FILA = {
    profile_id: '',
    ciphertext: 'e2e-no-vale',
    iv: 'e2e-no-vale',
    source: 'created',
  }

  for (const perfil of PERFILES) {
    describe(ETIQUETA[perfil], () => {
      it('select -> sin filas o error de permisos (nunca devuelve la copia)', async () => {
        const res = await tabla(
          clienteDe(perfil),
          'account_credentials',
        ).select('*')
        expect(denegado(res), describir(res)).toBe(true)
      })

      it('insert -> rechazado', async () => {
        const { ids } = contexto()
        const id = perfil === 'anon' ? ids.empleado1 : ids[CLAVE_ID[perfil]]
        const antes = await copiaDe(id)
        const res = await tabla(clienteDe(perfil), 'account_credentials')
          .insert({ ...FILA, profile_id: id })
          .select()
        expect(denegado(res), describir(res)).toBe(true)
        expect(await copiaDe(id)).toEqual(antes)
      })

      it('update de cualquier fila (también la propia) -> rechazado y sin cambios', async () => {
        const { ids } = contexto()
        const propio = perfil === 'anon' ? null : ids[CLAVE_ID[perfil]]
        for (const id of [
          ids.empleado1,
          ids.owner,
          ...(propio ? [propio] : []),
        ]) {
          const antes = await copiaDe(id)
          const res = await tabla(clienteDe(perfil), 'account_credentials')
            .update({ ciphertext: 'e2e-no-vale', source: 'self_change' })
            .eq('profile_id', id)
            .select()
          expect(denegado(res), describir(res)).toBe(true)
          expect(await copiaDe(id)).toEqual(antes)
        }
      })

      it('delete de cualquier fila (también la propia) -> rechazado y sin cambios', async () => {
        const { ids } = contexto()
        const propio = perfil === 'anon' ? null : ids[CLAVE_ID[perfil]]
        for (const id of [
          ids.empleado1,
          ids.owner,
          ...(propio ? [propio] : []),
        ]) {
          const antes = await copiaDe(id)
          const res = await tabla(clienteDe(perfil), 'account_credentials')
            .delete()
            .eq('profile_id', id)
            .select()
          expect(denegado(res), describir(res)).toBe(true)
          expect(await copiaDe(id)).toEqual(antes)
        }
      })
    })
  }
})
