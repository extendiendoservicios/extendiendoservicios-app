// tests/fixtures/api.ts — TEST-016 (P18.1)
//
// Pedidos por API directa (sin interfaz) con la sesión de una cuenta: errores de RPC y la Edge
// Function `admin-users`. Sirven para comprobar que el SERVIDOR rechaza lo que la interfaz
// oculta (`03_Plan_Maestro_Tecnico.md` sección 15: "la seguridad real es RLS").

import { expect } from '@playwright/test'
import { requireE2eEnv } from './env.ts'

interface RpcLike {
  error: { code?: string; message: string; hint?: string | null } | null
}

/** La RPC respondió con el código de error esperado (`hint`, ver `06_API.md` sección 15). */
export function expectHint(result: RpcLike, hint: string): void {
  expect(
    result.error,
    `se esperaba el error ${hint}, pero la RPC no falló`,
  ).not.toBeNull()
  expect(result.error?.hint, result.error?.message).toBe(hint)
}

export interface EdgeResult {
  status: number
  body: { data?: Record<string, unknown> } & {
    error?: { message: string; hint: string }
  }
}

/** Llama a `admin-users` con el `access_token` indicado como Bearer. */
export async function callAdminUsers(
  accessToken: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<EdgeResult> {
  const env = requireE2eEnv()
  const response = await fetch(`${env.supabaseUrl}/functions/v1/admin-users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action, ...body }),
  })
  return {
    status: response.status,
    body: (await response.json()) as EdgeResult['body'],
  }
}
