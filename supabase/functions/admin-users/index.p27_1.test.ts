// Tests Deno de P27.1 (OD-22, OD-23) sobre la Edge Function `admin-users`: la acción `delete_user`.
//   - Solo el dueño (un administrador, aun con manage_users, recibe FORBIDDEN y no se toca nada).
//   - Validaciones de entrada y que nadie se borre a sí mismo.
//   - El orden: primero la RPC `owner_delete_employee` con el JWT del dueño y, solo si salió bien,
//     el usuario de Auth y el avatar. Si la base bloquea (historia) o el nombre no coincide, Auth
//     queda intacto.
//   - Si Auth falla después de la RPC: AUTH_DELETE_FAILED, y repetir la acción termina el borrado
//     del usuario huérfano (sin llamar de nuevo a la RPC).
//   - El evento `record_deleted` del usuario de Auth, sin secretos.
//
// Cliente simulado con estado (tablas en memoria), solo con lo que esta acción consulta.

import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  actionDeleteUser,
  type Actor,
  DomainError,
  handleRequest,
} from './index.ts'

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'clave-falsa-para-tests')
Deno.env.set('SUPABASE_ANON_KEY', 'anon-falsa-para-tests')

const ID = {
  dueno: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  empleado: '33333333-3333-4333-8333-333333333333',
  huerfano: '44444444-4444-4444-8444-444444444444',
  fantasma: '55555555-5555-4555-8555-555555555555',
}

type Fila = Record<string, unknown>
interface Estado {
  perfiles: Set<string>
  auth: Set<string>
  roles: Record<string, string[]>
  capacidades: Record<string, string[]>
  eventos: Fila[]
  // Orden en que ocurrieron las cosas (RPC, borrado de Auth, avatar).
  bitacora: string[]
  avatarsBorrados: string[]
  fallaBorradoAuth: string | null
}

function nuevoEstado(): Estado {
  return {
    perfiles: new Set([ID.dueno, ID.admin, ID.empleado]),
    auth: new Set([ID.dueno, ID.admin, ID.empleado, ID.huerfano]),
    roles: {
      [ID.dueno]: ['owner'],
      [ID.admin]: ['admin'],
      [ID.empleado]: ['employee'],
    },
    capacidades: { [ID.admin]: ['manage_users'] },
    eventos: [],
    bitacora: [],
    avatarsBorrados: [],
    fallaBorradoAuth: null,
  }
}

// deno-lint-ignore no-explicit-any
function fakeAdmin(st: Estado): any {
  function from(table: string) {
    const filtros: Record<string, unknown> = {}
    let metodo: 'select' | 'insert' = 'select'
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
        return {
          data: st.perfiles.has(id)
            ? { id, is_active: true, deleted_at: null }
            : null,
          error: null,
        }
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
      is: () => b,
      gte: () => b,
      in: () => b,
      insert: (p: unknown) => {
        metodo = 'insert'
        payload = p
        return Promise.resolve(resolver())
      },
      maybeSingle: () => Promise.resolve(resolver()),
      then: (ok: (v: unknown) => void, ko: (e: unknown) => void) =>
        Promise.resolve().then(resolver).then(ok, ko),
    }
    return b
  }

  return {
    from,
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          st.bitacora.push(`storage:${bucket}`)
          st.avatarsBorrados.push(...paths)
          return Promise.resolve({ data: null, error: null })
        },
      }),
    },
    auth: {
      // El "JWT" de estos tests es directamente el id de la persona.
      getUser: (jwt: string) =>
        Promise.resolve(
          st.auth.has(jwt)
            ? { data: { user: { id: jwt } }, error: null }
            : { data: { user: null }, error: { message: 'x' } },
        ),
      admin: {
        getUserById: (id: string) =>
          Promise.resolve(
            st.auth.has(id)
              ? { data: { user: { id } }, error: null }
              : {
                  data: { user: null },
                  error: { code: 'user_not_found', message: 'no existe' },
                },
          ),
        deleteUser: (id: string) => {
          st.bitacora.push('auth:delete')
          if (st.fallaBorradoAuth) {
            return Promise.resolve({
              data: null,
              error: { code: st.fallaBorradoAuth, message: 'falla simulada' },
            })
          }
          if (!st.auth.has(id)) {
            return Promise.resolve({
              data: null,
              error: { code: 'user_not_found', message: 'no existe' },
            })
          }
          st.auth.delete(id)
          return Promise.resolve({ data: null, error: null })
        },
      },
    },
  }
}

const actor = (id: string, st: Estado): Actor => ({
  id,
  roles: st.roles[id] as Actor['roles'],
  capabilities: (st.capacidades[id] ?? []) as Actor['capabilities'],
  jwt: id,
})

type RespuestaRpc = {
  data: unknown
  error: {
    code?: string
    message?: string
    hint?: string
    details?: string
  } | null
}

// RPC simulada: registra con qué JWT y qué argumentos se llamó, y responde lo que se le indique.
function fakeRpc(st: Estado, respuesta: RespuestaRpc) {
  const llamadas: Array<{
    jwt: string
    fn: string
    args: Record<string, unknown>
  }> = []
  const rpc = (jwt: string, fn: string, args: Record<string, unknown>) => {
    st.bitacora.push(`rpc:${fn}`)
    llamadas.push({ jwt, fn, args })
    if (!respuesta.error) {
      // Lo que hace la base: el perfil desaparece.
      st.perfiles.delete(args.p_employee_id as string)
    }
    return Promise.resolve(respuesta)
  }
  return { rpc, llamadas }
}

const OK: RespuestaRpc = {
  data: {
    entity: 'employee',
    id: ID.empleado,
    name: 'Ana Pérez',
    deleted: { employees: 1, profiles: 1 },
    avatar_path: `${ID.empleado}/avatar.webp`,
    event_id: '99999999-9999-4999-8999-999999999999',
  },
  error: null,
}

async function falla(fn: () => Promise<unknown>): Promise<DomainError> {
  try {
    await fn()
  } catch (e) {
    if (e instanceof DomainError) return e
    throw e
  }
  throw new Error('se esperaba un DomainError y no falló')
}

Deno.test(
  'delete_user: un administrador (aun con manage_users) recibe FORBIDDEN y no se toca nada',
  async () => {
    const st = nuevoEstado()
    const { rpc, llamadas } = fakeRpc(st, OK)
    const e = await falla(() =>
      actionDeleteUser(
        fakeAdmin(st),
        actor(ID.admin, st),
        { profile_id: ID.empleado, confirm_name: 'Ana Pérez' },
        null,
        rpc,
      ),
    )
    assertEquals(e.hint, 'FORBIDDEN')
    assertEquals(e.status, 403)
    assertEquals(llamadas.length, 0)
    assert(st.auth.has(ID.empleado))
    assertEquals(st.bitacora, [])
  },
)

Deno.test('delete_user: validaciones de entrada', async () => {
  const st = nuevoEstado()
  const { rpc } = fakeRpc(st, OK)
  const a = actor(ID.dueno, st)
  const admin = fakeAdmin(st)
  const sinId = await falla(() =>
    actionDeleteUser(admin, a, { confirm_name: 'Ana' }, null, rpc),
  )
  assertEquals(sinId.hint, 'VALIDATION_ERROR')
  const idMalo = await falla(() =>
    actionDeleteUser(
      admin,
      a,
      { profile_id: 'no-es-uuid', confirm_name: 'Ana' },
      null,
      rpc,
    ),
  )
  assertEquals(idMalo.hint, 'VALIDATION_ERROR')
  const sinNombre = await falla(() =>
    actionDeleteUser(
      admin,
      a,
      { profile_id: ID.empleado, confirm_name: '   ' },
      null,
      rpc,
    ),
  )
  assertEquals(sinNombre.hint, 'VALIDATION_ERROR')
  assertEquals(st.bitacora, [])
})

Deno.test('delete_user: nadie se borra a sí mismo', async () => {
  const st = nuevoEstado()
  const { rpc, llamadas } = fakeRpc(st, OK)
  const e = await falla(() =>
    actionDeleteUser(
      fakeAdmin(st),
      actor(ID.dueno, st),
      { profile_id: ID.dueno, confirm_name: 'Dueño' },
      null,
      rpc,
    ),
  )
  assertEquals(e.hint, 'CANNOT_DELETE_SELF')
  assertEquals(e.status, 409)
  assertEquals(llamadas.length, 0)
  assert(st.auth.has(ID.dueno))
})

Deno.test(
  'delete_user: el dueño borra; la RPC va primero con su JWT y recién después Auth y el avatar',
  async () => {
    const st = nuevoEstado()
    const { rpc, llamadas } = fakeRpc(st, OK)
    const r = await actionDeleteUser(
      fakeAdmin(st),
      actor(ID.dueno, st),
      { profile_id: ID.empleado, confirm_name: 'Ana Pérez' },
      '10.0.0.1',
      rpc,
    )
    assertEquals(llamadas.length, 1)
    assertEquals(llamadas[0].jwt, ID.dueno)
    assertEquals(llamadas[0].fn, 'owner_delete_employee')
    assertEquals(llamadas[0].args, {
      p_employee_id: ID.empleado,
      p_confirm_name: 'Ana Pérez',
    })
    assertEquals(st.bitacora, [
      'rpc:owner_delete_employee',
      'auth:delete',
      'storage:avatars',
    ])
    assert(!st.auth.has(ID.empleado))
    assertEquals(st.avatarsBorrados, [`${ID.empleado}/avatar.webp`])
    assertEquals(r.profile_id, ID.empleado)
    assertEquals(r.name, 'Ana Pérez')

    assertEquals(st.eventos.length, 1)
    const ev = st.eventos[0]
    assertEquals(ev.event_type, 'record_deleted')
    assertEquals(ev.actor_id, ID.dueno)
    assertEquals(ev.target_id, null)
    const det = ev.details as Fila
    assertEquals(det.entity, 'auth_user')
    assertEquals(det.record_id, ID.empleado)
    assertEquals(det.completed_orphan, false)
    assertEquals(det.employee_event_id, '99999999-9999-4999-8999-999999999999')
  },
)

Deno.test(
  'delete_user: si la base bloquea por historia, Auth queda intacto y vuelve el detalle de los bloqueos',
  async () => {
    const st = nuevoEstado()
    const bloqueos = [
      {
        code: 'HAS_ATTENDANCE',
        count: 3,
        message: 'Esta persona tiene 3 fichajes.',
      },
    ]
    const { rpc } = fakeRpc(st, {
      data: null,
      error: {
        code: 'P0001',
        message:
          'No se puede eliminar a esta persona. Esta persona tiene 3 fichajes.',
        hint: 'DELETE_BLOCKED',
        details: JSON.stringify(bloqueos),
      },
    })
    const e = await falla(() =>
      actionDeleteUser(
        fakeAdmin(st),
        actor(ID.dueno, st),
        { profile_id: ID.empleado, confirm_name: 'Ana Pérez' },
        null,
        rpc,
      ),
    )
    assertEquals(e.hint, 'DELETE_BLOCKED')
    assertEquals(e.status, 409)
    assertEquals(e.details, bloqueos)
    assert(st.auth.has(ID.empleado))
    assert(st.perfiles.has(ID.empleado))
    assertEquals(st.bitacora, ['rpc:owner_delete_employee'])
    assertEquals(st.eventos.length, 0)
  },
)

Deno.test(
  'delete_user: nombre que no coincide, no encontrado y FORBIDDEN de la base conservan sus códigos',
  async () => {
    const casos: Array<[string, string, number]> = [
      ['CONFIRM_NAME_MISMATCH', 'El nombre que escribiste no coincide.', 400],
      ['EMPLOYEE_NOT_FOUND', 'No encontramos a ese empleado.', 404],
      ['FORBIDDEN', 'No tenés permiso para hacer esto.', 403],
    ]
    for (const [hint, message, status] of casos) {
      const st = nuevoEstado()
      const { rpc } = fakeRpc(st, {
        data: null,
        error: { code: 'P0001', message, hint },
      })
      const e = await falla(() =>
        actionDeleteUser(
          fakeAdmin(st),
          actor(ID.dueno, st),
          { profile_id: ID.empleado, confirm_name: 'Otro' },
          null,
          rpc,
        ),
      )
      assertEquals(e.hint, hint)
      assertEquals(e.status, status)
      assert(st.auth.has(ID.empleado), `${hint}: Auth no se toca`)
    }
  },
)

Deno.test(
  'delete_user: un error desconocido de la base es INTERNAL_ERROR y Auth no se toca',
  async () => {
    const st = nuevoEstado()
    const { rpc } = fakeRpc(st, {
      data: null,
      error: { code: '23503', message: 'viola una clave foránea' },
    })
    const original = console.error
    console.error = () => {}
    try {
      const e = await falla(() =>
        actionDeleteUser(
          fakeAdmin(st),
          actor(ID.dueno, st),
          { profile_id: ID.empleado, confirm_name: 'Ana Pérez' },
          null,
          rpc,
        ),
      )
      assertEquals(e.hint, 'INTERNAL_ERROR')
      // El mensaje crudo de Postgres no llega a la persona.
      assert(!e.message.includes('clave foránea'))
    } finally {
      console.error = original
    }
    assert(st.auth.has(ID.empleado))
  },
)

Deno.test(
  'delete_user: si Auth falla después de la RPC, AUTH_DELETE_FAILED; repetir termina el borrado del huérfano',
  async () => {
    const st = nuevoEstado()
    const { rpc, llamadas } = fakeRpc(st, OK)
    const original = console.error
    console.error = () => {}
    try {
      st.fallaBorradoAuth = 'unexpected_failure'
      const e = await falla(() =>
        actionDeleteUser(
          fakeAdmin(st),
          actor(ID.dueno, st),
          { profile_id: ID.empleado, confirm_name: 'Ana Pérez' },
          null,
          rpc,
        ),
      )
      assertEquals(e.hint, 'AUTH_DELETE_FAILED')
      assertEquals(e.status, 500)
      // La base ya quedó borrada y Auth sigue: es el huérfano.
      assert(!st.perfiles.has(ID.empleado))
      assert(st.auth.has(ID.empleado))
      assertEquals(st.eventos.length, 0)

      // Reintento: sin perfil, no vuelve a llamar a la RPC y borra el usuario de Auth.
      st.fallaBorradoAuth = null
      const r = await actionDeleteUser(
        fakeAdmin(st),
        actor(ID.dueno, st),
        { profile_id: ID.empleado, confirm_name: 'Ana Pérez' },
        null,
        rpc,
      )
      assertEquals(llamadas.length, 1)
      assert(!st.auth.has(ID.empleado))
      assertEquals(r.profile_id, ID.empleado)
      assertEquals(st.eventos.length, 1)
      assertEquals((st.eventos[0].details as Fila).completed_orphan, true)
    } finally {
      console.error = original
    }
  },
)

Deno.test(
  'delete_user: sin perfil ni usuario de Auth no hay nada que borrar (PROFILE_NOT_FOUND)',
  async () => {
    const st = nuevoEstado()
    const { rpc, llamadas } = fakeRpc(st, OK)
    const e = await falla(() =>
      actionDeleteUser(
        fakeAdmin(st),
        actor(ID.dueno, st),
        { profile_id: ID.fantasma, confirm_name: 'Nadie' },
        null,
        rpc,
      ),
    )
    assertEquals(e.hint, 'PROFILE_NOT_FOUND')
    assertEquals(e.status, 404)
    assertEquals(llamadas.length, 0)
  },
)

Deno.test(
  'delete_user por HTTP: está registrada en el router y un administrador recibe 403 y queda el intento rechazado',
  async () => {
    const st = nuevoEstado()
    const res = await handleRequest(
      new Request('https://example.supabase.co/functions/v1/admin-users', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ID.admin}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'delete_user',
          profile_id: ID.empleado,
          confirm_name: 'Ana Pérez',
        }),
      }),
      () => fakeAdmin(st),
    )
    assertEquals(res.status, 403)
    const json = await res.json()
    assertEquals(json.error.hint, 'FORBIDDEN')
    assertEquals(st.eventos.length, 1)
    assertEquals(st.eventos[0].event_type, 'admin_action_rejected')
    assertEquals((st.eventos[0].details as Fila).action, 'delete_user')
    assert(st.auth.has(ID.empleado))
  },
)
