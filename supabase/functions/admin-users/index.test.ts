// Tests Deno de la Edge Function `admin-users` (USERS-006, TEST-004).
//
// Dos capas de cobertura:
// 1. La parte que se puede probar sin una base de Postgres real detrás, a través de
//    `handleRequest` (validaciones, CORS, y las verificaciones que cortan ANTES de llamar a la
//    Admin API o a PostgREST -- Origin no permitido, sin Authorization, método).
// 2. La lógica de cada acción (`actionCreateUser`, `actionDeactivateUser`, etc.), llamándolas
//    directo con un cliente de Supabase simulado en vez de pasar por `handleRequest` -- estas
//    funciones ya reciben el cliente como parámetro, así que no hizo falta cambiar nada de su
//    comportamiento para poder inyectarles uno falso, solo exportarlas. El cliente simulado no
//    es un mock genérico de PostgREST: entiende lo justo para el escenario de cada test (por
//    tabla y por las columnas del `select`), así que sigue siendo honesto sobre qué cubre y qué
//    no -- por ejemplo, no reemplaza la verificación en vivo del límite de 10 acciones por
//    minuto ni del registro en `security_events`, que se hizo contra `App_dev` en P07.1.
//
// TEST-004 (`08_Fases_y_Backlog.md`) pide al menos: rechaza sin capacidad, crea usuario y no
// desactiva al último dueño -- las tres están más abajo, junto con las de `handleRequest`.
//
// `deno test` (ver supabase/functions/README.md): no necesita Docker ni el proyecto vinculado
// para nada de este archivo.

import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  handleRequest,
  requireOwnerOrManageUsers,
  actionCreateUser,
  actionDeactivateUser,
  DomainError,
  type Actor,
} from './index.ts'
import { ALLOWED_ORIGINS, corsHeaders } from '../_shared/cors.ts'

// createAdminClient() lee estas dos variables; con valores falsos alcanza para los casos de acá
// (ninguno llega a hacer una llamada de red real -- cortan antes, en la verificación de Origin o
// en "falta Authorization").
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'clave-falsa-para-tests')

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.supabase.co/functions/v1/admin-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

Deno.test(
  'corsHeaders: agrega Access-Control-Allow-Origin solo para orígenes permitidos',
  () => {
    for (const origin of ALLOWED_ORIGINS) {
      const headers = corsHeaders(origin) as Record<string, string>
      assertEquals(headers['Access-Control-Allow-Origin'], origin)
    }
    const headers = corsHeaders('https://sitio-ajeno.example')
    assertEquals(
      (headers as Record<string, string>)['Access-Control-Allow-Origin'],
      undefined,
    )
  },
)

Deno.test(
  'OPTIONS: responde 204 sin tocar nada más (preflight de CORS)',
  async () => {
    const req = new Request(
      'https://example.supabase.co/functions/v1/admin-users',
      {
        method: 'OPTIONS',
        headers: { Origin: 'https://dev.extendiendoservicios.com' },
      },
    )
    const res = await handleRequest(req)
    assertEquals(res.status, 204)
    assertEquals(
      res.headers.get('Access-Control-Allow-Origin'),
      'https://dev.extendiendoservicios.com',
    )
  },
)

Deno.test(
  'POST con Origin no permitido: 403 ORIGIN_NOT_ALLOWED, antes de mirar el resto',
  async () => {
    const req = postRequest(
      { action: 'create_user' },
      { Origin: 'https://sitio-ajeno.example' },
    )
    const res = await handleRequest(req)
    assertEquals(res.status, 403)
    const body = await res.json()
    assertEquals(body.error.hint, 'ORIGIN_NOT_ALLOWED')
  },
)

Deno.test('POST sin Authorization: 401 UNAUTHENTICATED', async () => {
  const req = postRequest(
    {
      action: 'sign_out_user',
      profile_id: '00000000-0000-0000-0000-000000000000',
    },
    { Origin: 'https://dev.extendiendoservicios.com' },
  )
  const res = await handleRequest(req)
  assertEquals(res.status, 401)
  const body = await res.json()
  assertEquals(body.error.hint, 'UNAUTHENTICATED')
})

Deno.test(
  'GET: 400 VALIDATION_ERROR (esta función solo acepta POST)',
  async () => {
    const req = new Request(
      'https://example.supabase.co/functions/v1/admin-users',
      {
        method: 'GET',
        headers: { Origin: 'https://dev.extendiendoservicios.com' },
      },
    )
    const res = await handleRequest(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error.hint, 'VALIDATION_ERROR')
  },
)

Deno.test(
  'POST sin Origin (llamada de servidor a servidor, sin navegador de por medio): sigue de largo hasta la siguiente verificación',
  async () => {
    // Sin cabecera Origin no hay nada que verificar en la lista blanca (no todo llamador legítimo
    // es un navegador -- por ejemplo, estos mismos tests); tiene que llegar hasta "falta
    // Authorization", no cortar antes por el Origin.
    const req = postRequest({ action: 'sign_out_user' })
    const res = await handleRequest(req)
    assertEquals(res.status, 401)
    const body = await res.json()
    assertEquals(body.error.hint, 'UNAUTHENTICATED')
  },
)

// -------------------------------------------------------------------------------------------
// TEST-004: cobertura de la lógica de las acciones sin depender de `App_dev`.
//
// Las funciones de acción (`actionCreateUser`, `actionDeactivateUser`, etc.) ya reciben el
// cliente de Supabase como parámetro (`admin: SupabaseClient`) en vez de crearlo ellas mismas:
// alcanza con exportarlas (no cambia nada de su comportamiento) y pasarles un cliente simulado
// que solo entiende las llamadas puntuales que cada escenario necesita. No es un mock genérico
// de PostgREST -- distingue las consultas por tabla y por las columnas del `select`, que es
// suficiente para estos tres escenarios y evita reescribir todo `supabase-js`.
// -------------------------------------------------------------------------------------------

interface FakeQueryContext {
  table: string
  selectColumns?: string
  method: 'select' | 'insert' | 'update'
  payload?: unknown
}

type FakeResponse = { data?: unknown; error?: unknown; count?: number | null }

/** Arma un `.from(tabla)` falso que resuelve según la función `responder` que le pasa cada test. */
function fakeQueryBuilder(
  table: string,
  responder: (ctx: FakeQueryContext) => FakeResponse,
) {
  const ctx: FakeQueryContext = { table, method: 'select' }
  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select: (columns?: string) => {
      ctx.selectColumns = columns
      return builder
    },
    eq: () => builder,
    neq: () => builder,
    is: () => builder,
    in: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: (payload: unknown) => {
      ctx.method = 'insert'
      ctx.payload = payload
      return Promise.resolve(responder(ctx))
    },
    update: (payload: unknown) => {
      ctx.method = 'update'
      ctx.payload = payload
      return builder
    },
    maybeSingle: () => Promise.resolve(responder(ctx)),
    single: () => Promise.resolve(responder(ctx)),
    // Cuando el llamador hace `await` directo sobre el builder (sin `.maybeSingle()`), lo que
    // resuelve la promesa es `.then` -- así funciona `PostgrestFilterBuilder` de verdad.
    then: (
      resolve: (value: FakeResponse) => void,
      reject: (reason: unknown) => void,
    ) => Promise.resolve(responder(ctx)).then(resolve, reject),
  }
  return builder
}

/** Cliente simulado con solo lo que necesita cada acción para el escenario del test. */
function createFakeAdminClient(config: {
  responder: (ctx: FakeQueryContext) => FakeResponse
  createUser?: (attrs: unknown) => Promise<FakeResponse>
}) {
  return {
    from: (table: string) => fakeQueryBuilder(table, config.responder),
    auth: {
      admin: {
        createUser:
          config.createUser ??
          (() =>
            Promise.resolve({
              data: { user: null },
              error: new Error('no implementado en este test'),
            })),
      },
    },
    // deno-lint-ignore no-explicit-any
  } as any
}

const OWNER_ACTOR: Actor = { id: 'owner-1', roles: ['owner'], capabilities: [] }
const ADMIN_SIN_CAPACIDAD_ACTOR: Actor = {
  id: 'admin-1',
  roles: ['admin'],
  capabilities: [],
}

Deno.test(
  'requireOwnerOrManageUsers: un admin sin manage_users no puede actuar (FORBIDDEN, no es el dueño)',
  () => {
    const err = assertThrows(
      () => requireOwnerOrManageUsers(ADMIN_SIN_CAPACIDAD_ACTOR),
      DomainError,
    )
    assertEquals(err.hint, 'FORBIDDEN')
    assertEquals(err.status, 403)
  },
)

Deno.test(
  'actionCreateUser: el dueño crea un administrador y quedan sus siete capacidades',
  async () => {
    const insertedRows: Record<string, unknown[]> = {}
    const admin = createFakeAdminClient({
      responder: (ctx) => {
        if (ctx.method === 'insert') {
          insertedRows[ctx.table] = Array.isArray(ctx.payload)
            ? (ctx.payload as unknown[])
            : [ctx.payload]
        }
        return { data: null, error: null }
      },
      createUser: () =>
        Promise.resolve({
          data: { user: { id: 'nuevo-admin-1' } },
          error: null,
        }),
    })

    const result = await actionCreateUser(
      admin,
      OWNER_ACTOR,
      {
        email: 'nuevo.admin@extendiendoservicios.example',
        password: 'contraseña-larga-1',
        first_name: 'Nueva',
        last_name: 'Administradora',
        roles: ['admin'],
      },
      null,
    )

    assertEquals(result, { profile_id: 'nuevo-admin-1' })
    assertEquals(
      (insertedRows.user_roles as Array<{ role: string }>)[0].role,
      'admin',
    )
    // Las siete capacidades (04 sección 2.1, CONFIRMADO por Mike en P07.0).
    assertEquals((insertedRows.admin_capabilities as unknown[]).length, 7)
  },
)

Deno.test(
  'actionDeactivateUser: no desactiva al último dueño activo (LAST_OWNER, defecto de P07.4)',
  async () => {
    const admin = createFakeAdminClient({
      responder: (ctx) => {
        if (ctx.table !== 'user_roles') {
          return { data: null, error: null }
        }
        // Con el hint de la FK explícita (`profiles!user_roles_profile_id_fkey!inner`), la
        // consulta del conteo de dueños activos se distingue de la del rol del destinatario
        // por las columnas que pide -- antes de la corrección, esta misma consulta sin el hint
        // le devolvía PGRST201 a PostgREST (ambigüedad entre `profile_id` y `granted_by`) y la
        // función terminaba en 500 en vez de validar la regla del último dueño.
        if (
          ctx.selectColumns?.includes('profiles!user_roles_profile_id_fkey')
        ) {
          // Ningún otro dueño activo además del que se quiere desactivar.
          return { count: 0, error: null }
        }
        // Rol del perfil destinatario: es dueño.
        return { data: [{ role: 'owner' }], error: null }
      },
    })

    const err = await (async () => {
      try {
        await actionDeactivateUser(
          admin,
          OWNER_ACTOR,
          { profile_id: 'owner-2', reason: 'motivo del test' },
          null,
        )
        return null
      } catch (e) {
        return e
      }
    })()

    if (!(err instanceof DomainError)) {
      throw new Error(
        'actionDeactivateUser tendría que rechazar con DomainError',
      )
    }
    assertEquals(err.hint, 'LAST_OWNER')
    assertEquals(err.status, 409)
  },
)
