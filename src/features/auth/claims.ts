import type { Database } from '@/lib/database.types'
import type { Role } from './session'

/** `admin_capability` (`04_Modelo_de_Datos.md` sección 3): solo se completa para admin. */
export type Capability = Database['public']['Enums']['admin_capability']

const VALID_ROLES: readonly Role[] = [
  'owner',
  'admin',
  'supervisor',
  'employee',
]

/**
 * Decodifica los claims `roles`/`capabilities` que agrega
 * `app.custom_access_token_hook` (`0003_profiles_roles_capabilities.sql`,
 * `0016_hardening.sql`) al `access_token` de la sesión (`06_API.md` sección
 * 1: "Leer roles y capacidades | claims roles, capabilities del JWT").
 *
 * Es la MISMA fuente que usan las políticas RLS del lado del servidor
 * (`app.jwt_roles()`/`app.jwt_capabilities()`, `0003`, leen `auth.jwt()`
 * sobre este mismo token): lo que el frontend ve acá es exactamente lo que
 * el servidor va a autorizar hasta el próximo refresh. Decodificar el
 * payload sin validar la firma es intencional y no es un problema de
 * seguridad — Supabase ya la validó al emitir el token y `supabase-js` no
 * expone la clave para volver a verificarla en el cliente; esto solo arma
 * la navegación, la autorización real vuelve a pasar por RLS en cada
 * pedido (`03_Plan_Maestro_Tecnico.md` sección 15, "RequireRole... solo
 * para experiencia").
 *
 * Cualquier error de formato (token vacío, payload que no es JSON válido,
 * `roles`/`capabilities` ausentes o con un tipo inesperado) devuelve
 * arreglos vacíos en lugar de lanzar: un token raro no debería voltear la
 * pantalla, solo dejar a la persona sin ningún rol (mismo criterio que el
 * hook, que ante cualquier duda entrega claims vacíos en vez de cortar el
 * login).
 */
export function decodeAccessTokenClaims(accessToken: string | undefined): {
  roles: Role[]
  capabilities: Capability[]
} {
  const empty = { roles: [] as Role[], capabilities: [] as Capability[] }
  const payloadSegment = accessToken?.split('.')[1]
  if (!payloadSegment) {
    return empty
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadSegment)) as {
      roles?: unknown
      capabilities?: unknown
    }
    const roles = Array.isArray(payload.roles)
      ? payload.roles.filter((value): value is Role =>
          VALID_ROLES.includes(value as Role),
        )
      : []
    const capabilities = Array.isArray(payload.capabilities)
      ? payload.capabilities.filter(
          (value): value is Capability => typeof value === 'string',
        )
      : []
    return { roles, capabilities }
  } catch {
    return empty
  }
}

/** Base64url (RFC 4648 §5) a texto UTF-8, como lo emite un JWT. */
function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '=',
  )
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}
