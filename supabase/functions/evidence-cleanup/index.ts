// Edge Function `evidence-cleanup` (módulo H · evidencia fotográfica, H-08, P21.1).
//
// Borrado nocturno de fotos y videos vencidos del bucket `evidence`. La dispara un workflow
// programado de GitHub Actions (P21.5), no una persona: por eso NO se autentica con el JWT de un
// usuario sino con un secreto propio (`EVIDENCE_CLEANUP_SECRET`) en el encabezado
// `x-evidence-cleanup-secret`. Si el secreto no está configurado, la función no corre (falla
// cerrada). La `service_role` se lee de `Deno.env` solo acá adentro, nunca se devuelve.
//
// Despliegue: lo hace P21.5 (infra-devops), con `verify_jwt = false` en `config.toml` porque el
// llamador no tiene JWT de usuario. Esta función no se despliega desde el paquete P21.1.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { runCleanup, type CleanupClient } from './cleanup.ts'

export const SECRET_HEADER = 'x-evidence-cleanup-secret'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Comparación en tiempo constante: se comparan los hashes SHA-256 de ambos valores.
export async function secretsMatch(
  received: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

function createAdminClient(): CleanupClient {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Faltan las variables de entorno de la función (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
    )
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as CleanupClient
}

export async function handleRequest(
  req: Request,
  makeClient: () => CleanupClient = createAdminClient,
): Promise<Response> {
  if (req.method !== 'POST') {
    return json(
      {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Solo se acepta POST.',
      },
      405,
    )
  }

  const expected = Deno.env.get('EVIDENCE_CLEANUP_SECRET')
  if (!expected) {
    return json(
      {
        ok: false,
        code: 'NOT_CONFIGURED',
        message: 'La función no tiene configurado su secreto.',
      },
      500,
    )
  }

  const received = req.headers.get(SECRET_HEADER)
  if (!received || !(await secretsMatch(received, expected))) {
    return json(
      { ok: false, code: 'UNAUTHORIZED', message: 'No autorizado.' },
      401,
    )
  }

  let client: CleanupClient
  try {
    client = makeClient()
  } catch (e) {
    return json(
      { ok: false, code: 'INTERNAL', message: (e as Error).message },
      500,
    )
  }

  const summary = await runCleanup(client)
  // Si hubo errores a mitad de camino se responde 500 con el resumen, así el workflow lo marca en rojo.
  return json(
    { ok: summary.errors.length === 0, ...summary },
    summary.errors.length === 0 ? 200 : 500,
  )
}

Deno.serve((req) => handleRequest(req))
