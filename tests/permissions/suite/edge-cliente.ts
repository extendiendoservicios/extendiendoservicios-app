// tests/permissions/suite/edge-cliente.ts — TEST-019 (P18.3)
//
// Llamadas a la Edge Function `admin-users` por HTTP directo (sin la interfaz), con el origen y
// el token que haga falta. Devuelve el estado HTTP y un código resumido: el `hint` del error de
// la función (`FORBIDDEN`, `EMPLOYEE_DATA_REQUIRED`...), el mensaje del gateway cuando el JWT es
// inválido, u `OK` si la acción se ejecutó.

import { requireE2eEnv } from '../../fixtures/env.ts'

export interface RespuestaEdge {
  status: number
  hint: string
  cuerpo: unknown
  cabeceras: Headers
}

export async function llamarEdge(
  token: string | null,
  cuerpo: unknown,
  opciones: { origen?: string; metodo?: string } = {},
): Promise<RespuestaEdge> {
  const env = requireE2eEnv()
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
