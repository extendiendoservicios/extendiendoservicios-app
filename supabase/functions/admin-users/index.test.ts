// Tests Deno de la Edge Function `admin-users` (USERS-006).
//
// Alcance de estos tests: la parte que se puede probar sin una base de Postgres real detrás
// (validaciones, CORS, y las verificaciones que cortan ANTES de llamar a la Admin API o a
// PostgREST -- Origin no permitido, sin Authorization). Las seis acciones en sí (crear, resetear,
// cambiar email, cerrar sesión, desactivar, reactivar), la regla del último owner, el límite de
// 10 acciones por minuto y el registro en `security_events` se verificaron en vivo contra
// `App_dev` (ver el reporte de la tarea): mockear acá toda la cadena de supabase-js
// (`.from().select().eq().maybeSingle()`, la Admin API de Auth, etc.) para cada una de las seis
// acciones habría significado reescribir un cliente falso casi tan grande como la función misma,
// con el riesgo de que el mock oculte un error real de integración -- se prefirió la verificación
// en vivo, más honesta para código que existe únicamente para hablar con Auth y con la base.
//
// `deno test` (ver supabase/functions/README.md): no necesita Docker ni el proyecto vinculado
// para esta parte.

import { assertEquals } from 'jsr:@std/assert@1'
import { handleRequest } from './index.ts'
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
