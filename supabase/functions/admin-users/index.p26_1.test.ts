// Tests Deno de P26.1 (credenciales visibles) sobre la Edge Function `admin-users`:
//   - `get_credentials`: quién ve a quién (CR-02, CR-07, CR-08), estados `ok` / `none` /
//     `unreadable`, evento `credentials_viewed` sin la contraseña y sin contar para el límite.
//   - `get_access_status` (P26.1b): mismo permiso, estados sin descifrar, sin evento de éxito.
//   - `create_user` y `reset_password` guardan la copia; si el guardado falla, Auth no cambia.
//   - `change_own_password`: cualquier persona con sesión (también la de recuperación), copia y Auth
//     a la vez, sin cerrar sesiones.
//
// Cliente simulado con estado (tablas en memoria): entiende solo lo que estas acciones consultan.
// Las claves de cifrado se generan acá; las contraseñas son ficticias.

import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1'
import {
  actionChangeOwnPassword,
  actionCreateUser,
  actionGetAccessStatus,
  actionGetCredentials,
  actionResetPassword,
  type Actor,
  DomainError,
  handleRequest,
} from './index.ts'
import { decrypt, encrypt } from '../_shared/credentials.ts'

function nuevaClave(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
}

const CLAVE = nuevaClave()
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'clave-falsa-para-tests')
Deno.env.set('SUPABASE_ANON_KEY', 'anon-falsa-para-tests')
Deno.env.set('CREDENTIALS_KEY', CLAVE)

// ---------------------------------------------------------------------------------------------
// Base y Auth simulados, con estado
// ---------------------------------------------------------------------------------------------

type Fila = Record<string, unknown>
interface Estado {
  roles: Record<string, string[]>
  capacidades: Record<string, string[]>
  perfiles: Set<string>
  auth: Record<string, { email: string; password: string }>
  credenciales: Record<string, Fila>
  eventos: Fila[]
  llamadasRpc: string[]
  consultasLimite: unknown[][]
  fallaGuardadoCopia: boolean
  fallaAuthUpdate: string | null // código de error de updateUserById
  actualizacionesAuth: Array<{ id: string; attrs: Record<string, unknown> }>
  // Cambios hechos por el camino de la persona (PUT /auth/v1/user con su JWT).
  cambiosPropios: Array<{ id: string; password: string }>
}

// PUT /auth/v1/user simulado: es el camino que usa change_own_password (DEF-P26-01). Lo que no es
// ese endpoint pasa al fetch real.
let estadoActual: Estado | null = null
const fetchReal = globalThis.fetch
globalThis.fetch = (input: Request | URL | string, init?: RequestInit) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  const st = estadoActual
  if (!url.endsWith('/auth/v1/user') || init?.method !== 'PUT' || !st) {
    return fetchReal(input, init)
  }
  const h = new Headers(init.headers)
  const id = (h.get('Authorization') ?? '').replace(/^Bearer /, '')
  const json = (status: number, body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  if (h.get('apikey') !== 'anon-falsa-para-tests' || !st.auth[id]) {
    return json(401, { code: 401, error_code: 'bad_jwt', msg: 'jwt inválido' })
  }
  const { password } = JSON.parse(String(init.body))
  if (st.fallaAuthUpdate === 'weak_password') {
    return json(422, { code: 422, error_code: 'weak_password', msg: 'débil' })
  }
  if (
    st.fallaAuthUpdate === 'same_password' ||
    st.auth[id].password === password
  ) {
    return json(422, { code: 422, error_code: 'same_password', msg: 'igual' })
  }
  if (st.fallaAuthUpdate) {
    return json(500, {
      code: 500,
      error_code: st.fallaAuthUpdate,
      msg: 'falla simulada de Auth',
    })
  }
  st.auth[id].password = password
  st.cambiosPropios.push({ id, password })
  return json(200, { id })
}

const PERSONAS = [
  'dueno-1',
  'dueno-2',
  'admin-1',
  'admin-2',
  'admin-sin-cap',
  'emp-1',
  'sup-1',
  'emp-admin',
]

function nuevoEstado(): Estado {
  return (estadoActual = {
    roles: {
      'dueno-1': ['owner'],
      'dueno-2': ['owner'],
      'admin-1': ['admin'],
      'admin-2': ['admin'],
      'admin-sin-cap': ['admin'],
      'emp-1': ['employee'],
      'sup-1': ['supervisor'],
      'emp-admin': ['employee', 'admin'],
    },
    capacidades: { 'admin-1': ['manage_users'], 'admin-2': ['manage_users'] },
    perfiles: new Set(PERSONAS),
    auth: Object.fromEntries(
      PERSONAS.map((id) => [
        id,
        { email: `${id}@ejemplo.test`, password: 'contraseña-vieja-1' },
      ]),
    ),
    credenciales: {},
    eventos: [],
    llamadasRpc: [],
    consultasLimite: [],
    fallaGuardadoCopia: false,
    fallaAuthUpdate: null,
    actualizacionesAuth: [],
    cambiosPropios: [],
  })
}

// deno-lint-ignore no-explicit-any
function fakeAdmin(st: Estado): any {
  function from(table: string) {
    const filtros: Record<string, unknown> = {}
    let metodo: 'select' | 'insert' | 'upsert' | 'delete' | 'update' = 'select'
    let payload: unknown
    function resolver(): { data?: unknown; error?: unknown; count?: number } {
      if (table === 'user_roles') {
        const id = filtros.profile_id as string
        return {
          data: (st.roles[id] ?? []).map((role) => ({ role })),
          error: null,
        }
      }
      if (table === 'admin_capabilities') {
        const id = filtros.profile_id as string
        return {
          data: (st.capacidades[id] ?? []).map((capability) => ({
            capability,
          })),
          error: null,
        }
      }
      if (table === 'profiles') {
        const id = filtros.id as string
        if (metodo === 'update') return { data: null, error: null }
        return {
          data: st.perfiles.has(id)
            ? { id, is_active: true, deleted_at: null }
            : null,
          error: null,
        }
      }
      if (table === 'employees') return { data: null, error: null }
      if (table === 'account_credentials') {
        const id = (filtros.profile_id ??
          (payload as Fila | undefined)?.profile_id) as string
        if (metodo === 'select') {
          return { data: st.credenciales[id] ?? null, error: null }
        }
        if (st.fallaGuardadoCopia && metodo === 'upsert') {
          return {
            data: null,
            error: { message: 'falla simulada del guardado' },
          }
        }
        if (metodo === 'upsert') st.credenciales[id] = { ...(payload as Fila) }
        if (metodo === 'delete') delete st.credenciales[id]
        return { data: null, error: null }
      }
      if (table === 'security_events') {
        if (metodo === 'insert') {
          st.eventos.push(payload as Fila)
          return { data: null, error: null }
        }
        return { data: null, error: null, count: 0 }
      }
      throw new Error(`tabla no simulada: ${table}`)
    }
    // deno-lint-ignore no-explicit-any
    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        filtros[col] = val
        return b
      },
      neq: () => b,
      is: () => b,
      gte: () => b,
      in: (col: string, vals: unknown[]) => {
        if (table === 'security_events' && col === 'event_type') {
          st.consultasLimite.push(vals)
        }
        return b
      },
      insert: (p: unknown) => {
        metodo = 'insert'
        payload = p
        return Promise.resolve(resolver())
      },
      upsert: (p: unknown) => {
        metodo = 'upsert'
        payload = p
        return Promise.resolve(resolver())
      },
      update: (p: unknown) => {
        metodo = 'update'
        payload = p
        return b
      },
      delete: () => {
        metodo = 'delete'
        return b
      },
      maybeSingle: () => Promise.resolve(resolver()),
      then: (ok: (v: unknown) => void, ko: (e: unknown) => void) =>
        Promise.resolve().then(resolver).then(ok, ko),
    }
    return b
  }

  return {
    from,
    rpc: (fn: string) => {
      st.llamadasRpc.push(fn)
      if (fn === 'admin_find_orphan_account') {
        return Promise.resolve({ data: null, error: null })
      }
      if (fn === 'admin_create_user_records') {
        return Promise.resolve({
          data: { employee_number: null },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    },
    auth: {
      // El "JWT" de estos tests es directamente el id de la persona.
      getUser: (jwt: string) =>
        Promise.resolve(
          st.auth[jwt]
            ? { data: { user: { id: jwt } }, error: null }
            : { data: { user: null }, error: { message: 'x' } },
        ),
      admin: {
        getUserById: (id: string) =>
          Promise.resolve(
            st.auth[id]
              ? {
                  data: { user: { id, email: st.auth[id].email } },
                  error: null,
                }
              : {
                  data: { user: null },
                  error: { code: 'user_not_found', message: 'no existe' },
                },
          ),
        createUser: (attrs: { email: string; password: string }) => {
          st.auth['nuevo-1'] = { email: attrs.email, password: attrs.password }
          st.perfiles.add('nuevo-1')
          return Promise.resolve({
            data: { user: { id: 'nuevo-1' } },
            error: null,
          })
        },
        updateUserById: (id: string, attrs: Record<string, unknown>) => {
          st.actualizacionesAuth.push({ id, attrs })
          if (st.fallaAuthUpdate) {
            return Promise.resolve({
              data: { user: null },
              error: {
                code: st.fallaAuthUpdate,
                message: 'falla simulada de Auth',
              },
            })
          }
          if (typeof attrs.password === 'string') {
            st.auth[id].password = attrs.password
          }
          return Promise.resolve({ data: { user: { id } }, error: null })
        },
      },
    },
  }
}

const actor = (id: string, st: Estado): Actor => ({
  id,
  roles: st.roles[id] as Actor['roles'],
  capabilities: (st.capacidades[id] ?? []) as Actor['capabilities'],
  jwt: id, // el "JWT" de estos tests es el id de la persona
})

async function guardarCopia(
  st: Estado,
  id: string,
  clear: string,
  source = 'created',
) {
  const s = await encrypt(clear, CLAVE)
  st.credenciales[id] = {
    profile_id: id,
    ciphertext: s.ciphertext,
    iv: s.iv,
    key_version: s.keyVersion,
    source,
    set_at: '2026-10-28T12:00:00Z',
    set_by: 'dueno-1',
  }
}

async function hint(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    if (e instanceof DomainError) return e.hint
    throw e
  }
  return 'NO_FALLO'
}

// Espía de console.error: ningún mensaje de log puede llevar una contraseña.
async function sinLogsConClaves(prohibidas: string[], fn: () => Promise<void>) {
  const original = console.error
  const lineas: string[] = []
  console.error = (...args: unknown[]) => {
    lineas.push(
      args
        .map((a) => (a instanceof Error ? a.message : JSON.stringify(a)))
        .join(' '),
    )
  }
  try {
    await fn()
  } finally {
    console.error = original
  }
  for (const l of lineas) {
    for (const c of prohibidas) {
      assert(!l.includes(c), `un log contiene una contraseña: ${l}`)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// get_credentials: quién ve a quién
// ---------------------------------------------------------------------------------------------

Deno.test(
  'get_credentials: el dueño ve a todos, incluido otro dueño y a sí mismo',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    const objetivos = [
      'emp-1',
      'sup-1',
      'admin-1',
      'emp-admin',
      'dueno-2',
      'dueno-1',
    ]
    for (const id of objetivos) {
      await guardarCopia(st, id, `clave-de-${id}`)
      const r = await actionGetCredentials(
        admin,
        actor('dueno-1', st),
        { profile_id: id },
        null,
      )
      assertEquals(r.password, `clave-de-${id}`)
      assertEquals(r.email, `${id}@ejemplo.test`)
      assertEquals(r.status, 'ok')
      assertEquals(r.source, 'created')
      assertEquals(r.set_at, '2026-10-28T12:00:00Z')
    }
    assertEquals(st.eventos.length, objetivos.length)
  },
)

Deno.test(
  'get_credentials: el admin con manage_users ve a un empleado y a un supervisor',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    for (const id of ['emp-1', 'sup-1']) {
      await guardarCopia(st, id, `clave-de-${id}`)
      const r = await actionGetCredentials(
        admin,
        actor('admin-1', st),
        { profile_id: id },
        null,
      )
      assertEquals(r.password, `clave-de-${id}`)
    }
  },
)

Deno.test(
  'get_credentials: el admin NO ve al dueño, a otro admin, ni a quien es empleado y admin',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    for (const id of ['dueno-1', 'admin-2', 'emp-admin', 'admin-1']) {
      await guardarCopia(st, id, `clave-de-${id}`)
      assertEquals(
        await hint(() =>
          actionGetCredentials(
            admin,
            actor('admin-1', st),
            { profile_id: id },
            null,
          ),
        ),
        'FORBIDDEN',
        `admin-1 no debería ver a ${id}`,
      )
    }
    // Rechazado: no se registra ningún credentials_viewed.
    assertEquals(st.eventos.length, 0)
  },
)

Deno.test('get_credentials: el admin sin manage_users no ve nada', async () => {
  const st = nuevoEstado()
  const admin = fakeAdmin(st)
  await guardarCopia(st, 'emp-1', 'clave-de-emp-1')
  assertEquals(
    await hint(() =>
      actionGetCredentials(
        admin,
        actor('admin-sin-cap', st),
        { profile_id: 'emp-1' },
        null,
      ),
    ),
    'FORBIDDEN',
  )
})

Deno.test(
  'get_credentials: empleado, supervisor y empleado+admin sin capacidad no pueden llamarla',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    await guardarCopia(st, 'emp-1', 'clave-de-emp-1')
    for (const quien of ['emp-1', 'sup-1', 'emp-admin']) {
      assertEquals(
        await hint(() =>
          actionGetCredentials(
            admin,
            actor(quien, st),
            { profile_id: 'emp-1' },
            null,
          ),
        ),
        'FORBIDDEN',
        `${quien} no debería poder`,
      )
    }
  },
)

Deno.test(
  'get_credentials: sin copia devuelve status none y password null; con clave rotada, unreadable',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    const sinCopia = await actionGetCredentials(
      admin,
      actor('dueno-1', st),
      { profile_id: 'emp-1' },
      null,
    )
    assertEquals(sinCopia.password, null)
    assertEquals(sinCopia.source, null)
    assertEquals(sinCopia.set_at, null)
    assertEquals(sinCopia.status, 'none')
    assertEquals(sinCopia.email, 'emp-1@ejemplo.test')

    // Copia hecha con OTRA clave (como si se hubiera rotado): no se descifra, sin basura.
    const otra = await encrypt('clave-que-no-se-puede-leer', nuevaClave())
    st.credenciales['emp-1'] = {
      profile_id: 'emp-1',
      ciphertext: otra.ciphertext,
      iv: otra.iv,
      key_version: 1,
      source: 'admin_reset',
      set_at: '2026-10-01T10:00:00Z',
      set_by: 'dueno-1',
    }
    await sinLogsConClaves(['clave-que-no-se-puede-leer'], async () => {
      const r = await actionGetCredentials(
        admin,
        actor('dueno-1', st),
        { profile_id: 'emp-1' },
        null,
      )
      assertEquals(r.password, null)
      assertEquals(r.status, 'unreadable')
      assertEquals(r.source, 'admin_reset')
    })
  },
)

Deno.test(
  'get_credentials: persona inexistente es PROFILE_NOT_FOUND; sin profile_id es VALIDATION_ERROR',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    assertEquals(
      await hint(() =>
        actionGetCredentials(
          admin,
          actor('dueno-1', st),
          { profile_id: 'no-existe' },
          null,
        ),
      ),
      'PROFILE_NOT_FOUND',
    )
    assertEquals(
      await hint(() =>
        actionGetCredentials(admin, actor('dueno-1', st), {}, null),
      ),
      'VALIDATION_ERROR',
    )
  },
)

Deno.test(
  'get_credentials: registra credentials_viewed sin la contraseña',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    await guardarCopia(st, 'emp-1', 'contraseña-secreta-77')
    await actionGetCredentials(
      admin,
      actor('admin-1', st),
      { profile_id: 'emp-1' },
      '10.0.0.1',
    )
    assertEquals(st.eventos.length, 1)
    const ev = st.eventos[0]
    assertEquals(ev.event_type, 'credentials_viewed')
    assertEquals(ev.actor_id, 'admin-1')
    assertEquals(ev.target_id, 'emp-1')
    assertEquals(ev.ip, '10.0.0.1')
    assertEquals(ev.details, { status: 'ok' })
    assert(!JSON.stringify(ev).includes('contraseña-secreta-77'))
  },
)

// ---------------------------------------------------------------------------------------------
// Por el router: límite de acciones y sesión de recuperación
// ---------------------------------------------------------------------------------------------

function post(body: unknown, jwt: string) {
  return new Request('https://example.supabase.co/functions/v1/admin-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://dev.extendiendoservicios.com',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  })
}

Deno.test(
  'router: credentials_viewed y password_changed_by_user no cuentan para el límite de 10 por minuto',
  async () => {
    const st = nuevoEstado()
    await guardarCopia(st, 'emp-1', 'clave-de-emp-1')
    const res = await handleRequest(
      post({ action: 'get_credentials', profile_id: 'emp-1' }, 'dueno-1'),
      () => fakeAdmin(st),
    )
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.data.password, 'clave-de-emp-1')
    assertEquals(st.consultasLimite.length, 1)
    const contados = st.consultasLimite[0] as string[]
    assert(contados.includes('password_reset_by_admin'))
    assert(!contados.includes('credentials_viewed'))
    assert(!contados.includes('password_changed_by_user'))
  },
)

Deno.test(
  'router: un empleado sin manage_users puede llamar change_own_password (la sesión de recuperación es un JWT común)',
  async () => {
    const st = nuevoEstado()
    const res = await handleRequest(
      post(
        {
          action: 'change_own_password',
          new_password: 'nueva-clave-123',
          origin: 'recovery',
        },
        'emp-1',
      ),
      () => fakeAdmin(st),
    )
    assertEquals(res.status, 200)
    assertEquals(st.auth['emp-1'].password, 'nueva-clave-123')
    assertEquals(st.credenciales['emp-1'].source, 'recovery')
    // No cierra las otras sesiones (CR-13).
    assert(!st.llamadasRpc.includes('admin_revoke_user_sessions'))
  },
)

Deno.test(
  'router: un supervisor no puede llamar get_credentials, y el intento queda como admin_action_rejected',
  async () => {
    const st = nuevoEstado()
    await guardarCopia(st, 'emp-1', 'clave-de-emp-1')
    const res = await handleRequest(
      post({ action: 'get_credentials', profile_id: 'emp-1' }, 'sup-1'),
      () => fakeAdmin(st),
    )
    assertEquals(res.status, 403)
    assertEquals((await res.json()).error.hint, 'FORBIDDEN')
    assertEquals(st.eventos[0].event_type, 'admin_action_rejected')
  },
)

// ---------------------------------------------------------------------------------------------
// change_own_password
// ---------------------------------------------------------------------------------------------

Deno.test(
  'change_own_password: cambia Auth y la copia a la vez, y registra el evento sin la contraseña',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    await guardarCopia(st, 'emp-1', 'contraseña-vieja-1')
    for (const [origen, fuente] of [
      ['profile', 'self_change'],
      ['recovery', 'recovery'],
    ] as const) {
      await actionChangeOwnPassword(
        admin,
        actor('emp-1', st),
        { new_password: `nueva-${origen}-123`, origin: origen },
        null,
      )
      assertEquals(st.auth['emp-1'].password, `nueva-${origen}-123`)
      // Con el JWT de la persona, no con la Admin API (que cierra todas las sesiones).
      assertEquals(st.cambiosPropios.at(-1), {
        id: 'emp-1',
        password: `nueva-${origen}-123`,
      })
      assertEquals(st.actualizacionesAuth.length, 0)
      const fila = st.credenciales['emp-1']
      assertEquals(fila.source, fuente)
      assertEquals(fila.set_by, 'emp-1')
      assertEquals(
        await decrypt(
          {
            ciphertext: fila.ciphertext as string,
            iv: fila.iv as string,
            keyVersion: 1,
          },
          CLAVE,
        ),
        `nueva-${origen}-123`,
      )
    }
    const ev = st.eventos.at(-1)!
    assertEquals(ev.event_type, 'password_changed_by_user')
    assertEquals(ev.details, { origin: 'recovery' })
    assert(!JSON.stringify(st.eventos).includes('nueva-'))
  },
)

Deno.test(
  'change_own_password: valida largo mínimo y origen, y no toca nada',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    assertEquals(
      await hint(() =>
        actionChangeOwnPassword(
          admin,
          actor('emp-1', st),
          { new_password: 'corta', origin: 'profile' },
          null,
        ),
      ),
      'VALIDATION_ERROR',
    )
    assertEquals(
      await hint(() =>
        actionChangeOwnPassword(
          admin,
          actor('emp-1', st),
          { new_password: 'larga-123456', origin: 'otra' },
          null,
        ),
      ),
      'VALIDATION_ERROR',
    )
    assertEquals(st.actualizacionesAuth.length, 0)
    assertEquals(Object.keys(st.credenciales).length, 0)
  },
)

Deno.test(
  'change_own_password: si falla el guardado de la copia, Auth queda como estaba',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    st.fallaGuardadoCopia = true
    await sinLogsConClaves(['nueva-clave-123'], async () => {
      assertEquals(
        await hint(() =>
          actionChangeOwnPassword(
            admin,
            actor('emp-1', st),
            { new_password: 'nueva-clave-123', origin: 'profile' },
            null,
          ),
        ),
        'INTERNAL_ERROR',
      )
    })
    assertEquals(st.actualizacionesAuth.length, 0)
    assertEquals(st.auth['emp-1'].password, 'contraseña-vieja-1')
  },
)

Deno.test(
  'change_own_password: si falla Auth, la copia vuelve a como estaba',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    await guardarCopia(st, 'emp-1', 'contraseña-vieja-1')
    const antes = { ...st.credenciales['emp-1'] }
    st.fallaAuthUpdate = 'unexpected_failure'
    await sinLogsConClaves(['nueva-clave-123'], async () => {
      assertEquals(
        await hint(() =>
          actionChangeOwnPassword(
            admin,
            actor('emp-1', st),
            { new_password: 'nueva-clave-123', origin: 'profile' },
            null,
          ),
        ),
        'INTERNAL_ERROR',
      )
    })
    assertEquals(st.credenciales['emp-1'], antes)
    assertEquals(st.eventos.length, 0)
    assertEquals(st.cambiosPropios.length, 0)

    // Sin copia previa: la restauración la borra.
    delete st.credenciales['emp-1']
    await hint(() =>
      actionChangeOwnPassword(
        admin,
        actor('emp-1', st),
        { new_password: 'nueva-clave-123', origin: 'profile' },
        null,
      ),
    )
    assertEquals(st.credenciales['emp-1'], undefined)
  },
)

Deno.test(
  'change_own_password: contraseña débil de Auth es VALIDATION_ERROR',
  async () => {
    const st = nuevoEstado()
    st.fallaAuthUpdate = 'weak_password'
    assertEquals(
      await hint(() =>
        actionChangeOwnPassword(
          fakeAdmin(st),
          actor('emp-1', st),
          { new_password: '12345678', origin: 'profile' },
          null,
        ),
      ),
      'VALIDATION_ERROR',
    )
  },
)

Deno.test(
  'change_own_password: contraseña igual a la actual es VALIDATION_ERROR y la copia no cambia',
  async () => {
    const st = nuevoEstado()
    await guardarCopia(st, 'emp-1', 'contraseña-vieja-1')
    const antes = { ...st.credenciales['emp-1'] }
    assertEquals(
      await hint(() =>
        actionChangeOwnPassword(
          fakeAdmin(st),
          actor('emp-1', st),
          { new_password: 'contraseña-vieja-1', origin: 'profile' },
          null,
        ),
      ),
      'VALIDATION_ERROR',
    )
    assertEquals(st.credenciales['emp-1'], antes)
  },
)

Deno.test(
  'change_own_password: sin JWT del llamador no toca nada (UNAUTHENTICATED)',
  async () => {
    const st = nuevoEstado()
    const sinJwt = { ...actor('emp-1', st), jwt: undefined }
    assertEquals(
      await hint(() =>
        actionChangeOwnPassword(
          fakeAdmin(st),
          sinJwt,
          { new_password: 'nueva-clave-123', origin: 'profile' },
          null,
        ),
      ),
      'UNAUTHENTICATED',
    )
    assertEquals(st.cambiosPropios.length, 0)
    assertEquals(Object.keys(st.credenciales).length, 0)
  },
)

// ---------------------------------------------------------------------------------------------
// create_user y reset_password guardan la copia
// ---------------------------------------------------------------------------------------------

const ALTA = {
  email: 'nueva@ejemplo.test',
  password: 'clave-de-alta-123',
  first_name: 'Nora',
  last_name: 'Celeste',
  roles: ['admin'],
}

Deno.test('create_user: guarda la copia con source created', async () => {
  const st = nuevoEstado()
  const admin = fakeAdmin(st)
  await actionCreateUser(admin, actor('dueno-1', st), ALTA, null)
  const fila = st.credenciales['nuevo-1']
  assertEquals(fila.source, 'created')
  assertEquals(fila.set_by, 'dueno-1')
  assertEquals(
    await decrypt(
      {
        ciphertext: fila.ciphertext as string,
        iv: fila.iv as string,
        keyVersion: 1,
      },
      CLAVE,
    ),
    'clave-de-alta-123',
  )
  assert(!JSON.stringify(st.eventos).includes('clave-de-alta-123'))
})

Deno.test(
  'create_user: si falla el guardado de la copia, el alta falla y no se guardan ficha ni roles',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    st.fallaGuardadoCopia = true
    await sinLogsConClaves(['clave-de-alta-123'], async () => {
      assertEquals(
        await hint(() =>
          actionCreateUser(admin, actor('dueno-1', st), ALTA, null),
        ),
        'INTERNAL_ERROR',
      )
    })
    // La cuenta de Auth queda sin ficha ni roles: el próximo intento la retoma (admin_find_orphan_account).
    assert(!st.llamadasRpc.includes('admin_create_user_records'))
    assertEquals(st.eventos.length, 0)
  },
)

Deno.test(
  'sin CREDENTIALS_KEY: CREDENTIALS_NOT_CONFIGURED antes de tocar Auth (alta, reseteo y cambio propio)',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    const original = Deno.env.get('CREDENTIALS_KEY')!
    Deno.env.delete('CREDENTIALS_KEY')
    try {
      assertEquals(
        await hint(() =>
          actionCreateUser(admin, actor('dueno-1', st), ALTA, null),
        ),
        'CREDENTIALS_NOT_CONFIGURED',
      )
      assertEquals(
        await hint(() =>
          actionResetPassword(
            admin,
            actor('dueno-1', st),
            { profile_id: 'emp-1', new_password: 'otra-clave-123' },
            null,
          ),
        ),
        'CREDENTIALS_NOT_CONFIGURED',
      )
      assertEquals(
        await hint(() =>
          actionChangeOwnPassword(
            admin,
            actor('emp-1', st),
            { new_password: 'otra-clave-123', origin: 'profile' },
            null,
          ),
        ),
        'CREDENTIALS_NOT_CONFIGURED',
      )
    } finally {
      Deno.env.set('CREDENTIALS_KEY', original)
    }
    assertEquals(st.actualizacionesAuth.length, 0)
    assertEquals(st.auth['nuevo-1'], undefined)
  },
)

Deno.test(
  'reset_password: guarda la copia con source admin_reset y la ve el dueño',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    await actionResetPassword(
      admin,
      actor('admin-1', st),
      { profile_id: 'emp-1', new_password: 'puesta-por-admin-1' },
      null,
    )
    const fila = st.credenciales['emp-1']
    assertEquals(fila.source, 'admin_reset')
    assertEquals(fila.set_by, 'admin-1')
    assertEquals(st.auth['emp-1'].password, 'puesta-por-admin-1')
    assert(st.llamadasRpc.includes('admin_revoke_user_sessions'))
    const r = await actionGetCredentials(
      admin,
      actor('dueno-1', st),
      { profile_id: 'emp-1' },
      null,
    )
    assertEquals(r.password, 'puesta-por-admin-1')
  },
)

Deno.test(
  'reset_password: si falla el guardado Auth no cambia; si falla Auth la copia vuelve atrás',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    await guardarCopia(st, 'emp-1', 'contraseña-vieja-1')
    const antes = { ...st.credenciales['emp-1'] }
    const reset = () =>
      actionResetPassword(
        admin,
        actor('dueno-1', st),
        { profile_id: 'emp-1', new_password: 'otra-clave-123' },
        null,
      )

    st.fallaGuardadoCopia = true
    assertEquals(await hint(reset), 'INTERNAL_ERROR')
    assertEquals(st.actualizacionesAuth.length, 0)
    assertEquals(st.credenciales['emp-1'], antes)

    st.fallaGuardadoCopia = false
    st.fallaAuthUpdate = 'unexpected_failure'
    assertEquals(await hint(reset), 'INTERNAL_ERROR')
    assertEquals(st.credenciales['emp-1'], antes)
    assertNotEquals(st.auth['emp-1'].password, 'otra-clave-123')
  },
)

Deno.test(
  'reset_password: el admin sigue sin poder resetear a un dueño ni a otro admin (regla intacta)',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    for (const id of ['dueno-1', 'admin-2']) {
      assertEquals(
        await hint(() =>
          actionResetPassword(
            admin,
            actor('admin-1', st),
            { profile_id: id, new_password: 'otra-clave-123' },
            null,
          ),
        ),
        'FORBIDDEN',
      )
    }
    assertEquals(st.actualizacionesAuth.length, 0)
  },
)

// ---------------------------------------------------------------------------------------------
// get_access_status (P26.1b): estado sin descifrar
// ---------------------------------------------------------------------------------------------

Deno.test(
  'get_access_status: mismos permisos que get_credentials (dueño, admin con manage_users, resto FORBIDDEN)',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    const intentar = (quien: string, objetivo: string) =>
      actionGetAccessStatus(
        admin,
        actor(quien, st),
        { profile_id: objetivo },
        null,
      )
    for (const id of [
      'emp-1',
      'sup-1',
      'admin-1',
      'emp-admin',
      'dueno-2',
      'dueno-1',
    ]) {
      assertEquals((await intentar('dueno-1', id)).email, `${id}@ejemplo.test`)
    }
    for (const id of ['emp-1', 'sup-1']) {
      assertEquals((await intentar('admin-1', id)).email, `${id}@ejemplo.test`)
    }
    for (const id of ['dueno-1', 'admin-2', 'emp-admin', 'admin-1']) {
      assertEquals(await hint(() => intentar('admin-1', id)), 'FORBIDDEN', id)
    }
    assertEquals(
      await hint(() => intentar('admin-sin-cap', 'emp-1')),
      'FORBIDDEN',
    )
    for (const quien of ['emp-1', 'sup-1', 'emp-admin']) {
      assertEquals(
        await hint(() => intentar(quien, 'emp-1')),
        'FORBIDDEN',
        quien,
      )
    }
    assertEquals(
      await hint(() => intentar('dueno-1', 'no-existe')),
      'PROFILE_NOT_FOUND',
    )
    assertEquals(
      await hint(() =>
        actionGetAccessStatus(admin, actor('dueno-1', st), {}, null),
      ),
      'VALIDATION_ERROR',
    )
    // Ni los éxitos ni los rechazos de la acción directa registran nada.
    assertEquals(st.eventos.length, 0)
  },
)

Deno.test(
  'get_access_status: tres estados (con copia, sin copia, key_version distinta) y nunca trae la contraseña',
  async () => {
    const st = nuevoEstado()
    const admin = fakeAdmin(st)
    const dueno = actor('dueno-1', st)

    const sin = await actionGetAccessStatus(
      admin,
      dueno,
      { profile_id: 'emp-1' },
      null,
    )
    assertEquals(sin, {
      email: 'emp-1@ejemplo.test',
      has_copy: false,
      readable: null,
      status: 'none',
      source: null,
      set_at: null,
    })

    await guardarCopia(st, 'emp-1', 'contraseña-secreta-77', 'admin_reset')
    const con = await actionGetAccessStatus(
      admin,
      dueno,
      { profile_id: 'emp-1' },
      null,
    )
    assertEquals(con, {
      email: 'emp-1@ejemplo.test',
      has_copy: true,
      readable: true,
      status: 'ok',
      source: 'admin_reset',
      set_at: '2026-10-28T12:00:00Z',
    })

    st.credenciales['emp-1'].key_version = 2
    const otra = await actionGetAccessStatus(
      admin,
      dueno,
      { profile_id: 'emp-1' },
      null,
    )
    assertEquals(otra.has_copy, true)
    assertEquals(otra.readable, false)
    assertEquals(otra.status, 'unreadable')
    assertEquals(otra.source, 'admin_reset')

    for (const r of [sin, con, otra]) {
      assert(!('password' in r))
      assert(!('ciphertext' in r))
      assert(!('iv' in r))
      assert(!JSON.stringify(r).includes('contraseña-secreta-77'))
    }
  },
)

Deno.test(
  'get_access_status: no necesita CREDENTIALS_KEY (no descifra)',
  async () => {
    const st = nuevoEstado()
    await guardarCopia(st, 'emp-1', 'clave-de-emp-1')
    Deno.env.delete('CREDENTIALS_KEY')
    try {
      const r = await actionGetAccessStatus(
        fakeAdmin(st),
        actor('dueno-1', st),
        { profile_id: 'emp-1' },
        null,
      )
      assertEquals(r.status, 'ok')
    } finally {
      Deno.env.set('CREDENTIALS_KEY', CLAVE)
    }
  },
)

Deno.test(
  'router: get_access_status no registra credentials_viewed ni ningún evento, y el rechazo queda como admin_action_rejected',
  async () => {
    const st = nuevoEstado()
    await guardarCopia(st, 'emp-1', 'clave-de-emp-1')
    const ok = await handleRequest(
      post({ action: 'get_access_status', profile_id: 'emp-1' }, 'admin-1'),
      () => fakeAdmin(st),
    )
    assertEquals(ok.status, 200)
    const cuerpo = await ok.json()
    assertEquals(cuerpo.data.status, 'ok')
    assert(!JSON.stringify(cuerpo).includes('clave-de-emp-1'))
    assertEquals(st.eventos.length, 0)

    const no = await handleRequest(
      post({ action: 'get_access_status', profile_id: 'emp-1' }, 'sup-1'),
      () => fakeAdmin(st),
    )
    assertEquals(no.status, 403)
    assertEquals((await no.json()).error.hint, 'FORBIDDEN')
    assertEquals(st.eventos.length, 1)
    assertEquals(st.eventos[0].event_type, 'admin_action_rejected')
    assert(!st.eventos.some((e) => e.event_type === 'credentials_viewed'))
  },
)
