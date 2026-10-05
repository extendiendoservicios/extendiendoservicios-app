// Tests Deno de las correcciones de P18.6 sobre la Edge Function `admin-users`:
//   - SEG-07: `http://localhost:5173` ya no está en la lista base de orígenes; solo entra por el
//     secreto `ALLOWED_ORIGINS_EXTRA` (cargado en `App_dev`, nunca en producción).
//   - DEF-P08: `sign_out_user` de una persona que no existe responde PROFILE_NOT_FOUND.
//   - SEG-03: el límite de 10 acciones por minuto cuenta también los intentos rechazados
//     (FORBIDDEN, validación, acción desconocida), registrados como `admin_action_rejected`.
//
// Mismo criterio que `index.test.ts`: sin Docker ni proyecto vinculado, con un cliente de
// Supabase simulado que se inyecta en `handleRequest` (segundo parámetro) o en la acción.

import { assertEquals } from 'jsr:@std/assert@1'
import {
  actionSignOutUser,
  DomainError,
  handleRequest,
  type Actor,
} from './index.ts'
import {
  ALLOWED_ORIGINS,
  corsHeaders,
  extraAllowedOrigins,
  getAllowedOrigins,
} from '../_shared/cors.ts'

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'clave-falsa-para-tests')

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.supabase.co/functions/v1/admin-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------------------------
// Cliente simulado: entiende lo justo para estos escenarios (por tabla y método).
// ---------------------------------------------------------------------------------------------

interface Consulta {
  table: string
  method: 'select' | 'insert' | 'update'
  payload?: unknown
}
type Respuesta = { data?: unknown; error?: unknown; count?: number | null }

function constructor(
  table: string,
  responder: (c: Consulta) => Respuesta,
  // deno-lint-ignore no-explicit-any
): any {
  const c: Consulta = { table, method: 'select' }
  // deno-lint-ignore no-explicit-any
  const b: any = {
    select: () => b,
    eq: () => b,
    neq: () => b,
    is: () => b,
    in: () => b,
    gte: () => b,
    insert: (payload: unknown) => {
      c.method = 'insert'
      c.payload = payload
      return Promise.resolve(responder(c))
    },
    update: () => {
      c.method = 'update'
      return b
    },
    maybeSingle: () => Promise.resolve(responder(c)),
    single: () => Promise.resolve(responder(c)),
    then: (resolve: (v: Respuesta) => void, reject: (r: unknown) => void) =>
      Promise.resolve(responder(c)).then(resolve, reject),
  }
  return b
}

function clienteSimulado(config: {
  responder: (c: Consulta) => Respuesta
  getUser?: () => Promise<Respuesta>
  rpc?: () => Promise<Respuesta>
  // deno-lint-ignore no-explicit-any
}): any {
  return {
    from: (table: string) => constructor(table, config.responder),
    rpc: config.rpc ?? (() => Promise.resolve({ data: null, error: null })),
    auth: {
      getUser:
        config.getUser ??
        (() =>
          Promise.resolve({
            data: { user: null },
            error: new Error('sin sesión'),
          })),
    },
  }
}

const DUENO: Actor = { id: 'owner-1', roles: ['owner'], capabilities: [] }

// ---------------------------------------------------------------------------------------------
// SEG-07
// ---------------------------------------------------------------------------------------------

Deno.test(
  'SEG-07: la lista base no incluye ningún origen local (producción no los acepta)',
  () => {
    Deno.env.delete('ALLOWED_ORIGINS_EXTRA')
    for (const origin of ALLOWED_ORIGINS) {
      assertEquals(origin.startsWith('https://'), true, origin)
    }
    assertEquals(getAllowedOrigins().includes('http://localhost:5173'), false)
    const headers = corsHeaders('http://localhost:5173') as Record<
      string,
      string
    >
    assertEquals(headers['Access-Control-Allow-Origin'], undefined)
  },
)

Deno.test(
  'SEG-07: con ALLOWED_ORIGINS_EXTRA (App_dev) se acepta localhost:5173',
  () => {
    Deno.env.set('ALLOWED_ORIGINS_EXTRA', 'http://localhost:5173')
    try {
      assertEquals(getAllowedOrigins().includes('http://localhost:5173'), true)
      const headers = corsHeaders('http://localhost:5173') as Record<
        string,
        string
      >
      assertEquals(
        headers['Access-Control-Allow-Origin'],
        'http://localhost:5173',
      )
    } finally {
      Deno.env.delete('ALLOWED_ORIGINS_EXTRA')
    }
  },
)

Deno.test(
  'SEG-07: ALLOWED_ORIGINS_EXTRA solo admite orígenes locales; cualquier otro se ignora',
  () => {
    Deno.env.set(
      'ALLOWED_ORIGINS_EXTRA',
      ' http://localhost:4173 , https://sitio-ajeno.example, http://127.0.0.1:5173, http://evil.localhost.example ',
    )
    try {
      assertEquals(extraAllowedOrigins(), [
        'http://localhost:4173',
        'http://127.0.0.1:5173',
      ])
    } finally {
      Deno.env.delete('ALLOWED_ORIGINS_EXTRA')
    }
  },
)

Deno.test(
  'SEG-07: handleRequest rechaza localhost:5173 si el secreto no está cargado',
  async () => {
    Deno.env.delete('ALLOWED_ORIGINS_EXTRA')
    const res = await handleRequest(
      postRequest(
        { action: 'sign_out_user' },
        { Origin: 'http://localhost:5173' },
      ),
    )
    assertEquals(res.status, 403)
    assertEquals((await res.json()).error.hint, 'ORIGIN_NOT_ALLOWED')
  },
)

// ---------------------------------------------------------------------------------------------
// DEF-P08
// ---------------------------------------------------------------------------------------------

Deno.test(
  'DEF-P08: sign_out_user de una persona que no existe -> PROFILE_NOT_FOUND, sin cerrar sesiones ni dejar evento',
  async () => {
    let revocaciones = 0
    let eventos = 0
    const admin = clienteSimulado({
      responder: (c) => {
        if (c.table === 'security_events' && c.method === 'insert') eventos++
        if (c.table === 'user_roles') return { data: [], error: null }
        // profiles: no hay ninguna fila con ese id.
        return { data: null, error: null }
      },
      rpc: () => {
        revocaciones++
        return Promise.resolve({ data: null, error: null })
      },
    })

    const err = await actionSignOutUser(
      admin,
      DUENO,
      { profile_id: '00000000-0000-4000-8000-000000000001' },
      null,
    ).then(
      () => null,
      (e) => e,
    )
    if (!(err instanceof DomainError)) {
      throw new Error('actionSignOutUser tendría que rechazar con DomainError')
    }
    assertEquals(err.hint, 'PROFILE_NOT_FOUND')
    assertEquals(err.status, 404)
    assertEquals(revocaciones, 0)
    assertEquals(eventos, 0)
  },
)

Deno.test(
  'DEF-P08: sign_out_user de una persona que existe sigue funcionando y registra su evento',
  async () => {
    let revocaciones = 0
    const eventos: unknown[] = []
    const admin = clienteSimulado({
      responder: (c) => {
        if (c.table === 'security_events' && c.method === 'insert') {
          eventos.push(c.payload)
          return { data: null, error: null }
        }
        if (c.table === 'user_roles') {
          return { data: [{ role: 'employee' }], error: null }
        }
        return { data: { id: 'emp-1' }, error: null }
      },
      rpc: () => {
        revocaciones++
        return Promise.resolve({ data: null, error: null })
      },
    })
    const result = await actionSignOutUser(
      admin,
      DUENO,
      { profile_id: 'emp-1' },
      null,
    )
    assertEquals(result, { profile_id: 'emp-1' })
    assertEquals(revocaciones, 1)
    assertEquals(eventos.length, 1)
  },
)

// ---------------------------------------------------------------------------------------------
// SEG-03: handleRequest completo, con el actor "administrador SIN capacidades".
// ---------------------------------------------------------------------------------------------

function fakeParaHandleRequest(opciones: { eventosRecientes: number }) {
  const insertados: Array<Record<string, unknown>> = []
  const admin = clienteSimulado({
    getUser: () =>
      Promise.resolve({ data: { user: { id: 'admin-1' } }, error: null }),
    responder: (c) => {
      if (c.table === 'profiles') {
        return { data: { is_active: true, deleted_at: null }, error: null }
      }
      if (c.table === 'user_roles') {
        return { data: [{ role: 'admin' }], error: null }
      }
      if (c.table === 'admin_capabilities') {
        return { data: [], error: null }
      }
      if (c.table === 'security_events') {
        if (c.method === 'insert') {
          insertados.push(c.payload as Record<string, unknown>)
          return { data: null, error: null }
        }
        return { count: opciones.eventosRecientes, error: null }
      }
      return { data: null, error: null }
    },
  })
  return { admin, insertados }
}

const CON_SESION = { Authorization: 'Bearer token-de-prueba' }

Deno.test(
  'SEG-03: un intento rechazado por FORBIDDEN queda registrado como admin_action_rejected',
  async () => {
    const { admin, insertados } = fakeParaHandleRequest({ eventosRecientes: 0 })
    const res = await handleRequest(
      postRequest(
        { action: 'sign_out_user', profile_id: 'otro-1' },
        CON_SESION,
      ),
      () => admin,
    )
    assertEquals(res.status, 403)
    assertEquals((await res.json()).error.hint, 'FORBIDDEN')
    assertEquals(insertados.length, 1)
    assertEquals(insertados[0].event_type, 'admin_action_rejected')
    assertEquals(insertados[0].actor_id, 'admin-1')
    assertEquals(insertados[0].details, {
      action: 'sign_out_user',
      hint: 'FORBIDDEN',
    })
  },
)

Deno.test('SEG-03: una acción desconocida también se registra', async () => {
  const { admin, insertados } = fakeParaHandleRequest({ eventosRecientes: 0 })
  const res = await handleRequest(
    postRequest({ action: 'borrar_todo' }, CON_SESION),
    () => admin,
  )
  assertEquals(res.status, 400)
  assertEquals(insertados.length, 1)
  assertEquals(
    (insertados[0].details as Record<string, unknown>).hint,
    'UNKNOWN_ACTION',
  )
})

Deno.test(
  'SEG-03: con 10 eventos en el último minuto (exitosos o rechazados) responde RATE_LIMITED y no suma otro',
  async () => {
    const { admin, insertados } = fakeParaHandleRequest({
      eventosRecientes: 10,
    })
    const res = await handleRequest(
      postRequest(
        { action: 'sign_out_user', profile_id: 'otro-1' },
        CON_SESION,
      ),
      () => admin,
    )
    assertEquals(res.status, 429)
    assertEquals((await res.json()).error.hint, 'RATE_LIMITED')
    // No se registra el rechazo por límite: si no, un bloqueo se auto-prolongaría.
    assertEquals(insertados.length, 0)
  },
)

Deno.test(
  'SEG-03: sin sesión válida (UNAUTHENTICATED) no se registra nada: todavía no se sabe quién es',
  async () => {
    const { admin, insertados } = fakeParaHandleRequest({ eventosRecientes: 0 })
    const res = await handleRequest(
      postRequest({ action: 'sign_out_user', profile_id: 'otro-1' }),
      () => admin,
    )
    assertEquals(res.status, 401)
    assertEquals(insertados.length, 0)
  },
)
