// tests/permissions/suite/edge-cliente.ts — TEST-019 (P18.3)
//
// Llamadas a la Edge Function `admin-users` por HTTP directo (sin la interfaz), con el origen y
// el token que haga falta. Devuelve el estado HTTP y un código resumido: el `hint` del error de
// la función (`FORBIDDEN`, `EMPLOYEE_DATA_REQUIRED`...), el mensaje del gateway cuando el JWT es
// inválido, u `OK` si la acción se ejecutó.

import { requireE2eEnv } from '../../fixtures/env.ts'
import { servicio } from './contexto.ts'

export interface RespuestaEdge {
  status: number
  hint: string
  cuerpo: unknown
  cabeceras: Headers
}

/** `sub` (id de la persona) de un JWT, o null si no se puede leer. */
export function subDelToken(token: string): string | null {
  try {
    const carga = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { sub?: string }
    return carga.sub ?? null
  } catch {
    return null
  }
}

/**
 * Desde P18.6 (SEG-03) el límite de 10 acciones por minuto de `admin-users` cuenta también los
 * intentos RECHAZADOS (evento `admin_action_rejected`). Esta matriz hace muchos a propósito
 * (FORBIDDEN, no encontrado) con las mismas cuentas fijas: antes de cada llamada se borran los
 * eventos de rechazo de quien llama, para que la matriz no tropiece con su propio límite. El
 * límite en sí se prueba aparte (`60-edge`, "límite de acciones por minuto").
 */
export async function liberarLimite(token: string | null): Promise<void> {
  const sub = token ? subDelToken(token) : null
  if (!sub) return
  await servicio()
    .from('security_events')
    .delete()
    .eq('event_type', 'admin_action_rejected')
    .eq('actor_id', sub)
}

export async function llamarEdge(
  token: string | null,
  cuerpo: unknown,
  opciones: {
    origen?: string
    metodo?: string
    conservarLimite?: boolean
  } = {},
): Promise<RespuestaEdge> {
  const env = requireE2eEnv()
  if (!opciones.conservarLimite) await liberarLimite(token)
  const cabeceras: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: env.anonKey,
  }
  if (token) cabeceras.Authorization = `Bearer ${token}`
  if (opciones.origen) cabeceras.Origin = opciones.origen
  const metodo = opciones.metodo ?? 'POST'
  const respuesta = await fetch(`${env.supabaseUrl}/functions/v1/admin-users`, {
    method: metodo,
    headers: cabeceras,
    body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined,
  })
  const texto = await respuesta.text()
  let json: unknown = null
  try {
    json = JSON.parse(texto)
  } catch {
    json = texto
  }
  const objeto = (json ?? {}) as {
    error?: { hint?: string; message?: string }
    message?: string
    data?: unknown
  }
  const hint =
    objeto.error?.hint ??
    (respuesta.ok ? 'OK' : (objeto.message ?? `HTTP ${respuesta.status}`))
  return {
    status: respuesta.status,
    hint,
    cuerpo: json,
    cabeceras: respuesta.headers,
  }
}

/** Preflight CORS (`OPTIONS`) desde un origen dado. */
export async function preflight(origen: string): Promise<Response> {
  const env = requireE2eEnv()
  return fetch(`${env.supabaseUrl}/functions/v1/admin-users`, {
    method: 'OPTIONS',
    headers: {
      Origin: origen,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,apikey',
    },
  })
}
