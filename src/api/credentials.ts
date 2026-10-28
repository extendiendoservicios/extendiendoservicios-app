import { invokeAdminUsers } from './users'

/**
 * P26.2 (CR-01, CR-10): acceso a la app (usuario y contraseña) que ve la
 * administración desde ADM-17 y ADM-27. Un solo punto de entrada: la
 * acción `get_credentials` de la Edge Function `admin-users`.
 *
 * Errores del servidor (se muestran con su `message`, la lógica usa el
 * `hint`): `FORBIDDEN`, `PROFILE_NOT_FOUND`, `VALIDATION_ERROR` y
 * `CREDENTIALS_NOT_CONFIGURED` (falta la clave de cifrado en el servidor).
 *
 * La contraseña viaja en la respuesta y nada más: este módulo no la
 * escribe en consola ni la guarda en ningún lado.
 */

/** De dónde salió la copia de la contraseña (`password_credentials.source`). */
export type CredentialSource =
  'created' | 'admin_reset' | 'self_change' | 'recovery' | 'initial_delivery'

/** `ok`: hay copia legible; `none`: nunca se guardó; `unreadable`: no se pudo descifrar. */
export type CredentialStatus = 'ok' | 'none' | 'unreadable'

export interface Credentials {
  email: string | null
  password: string | null
  source: CredentialSource | null
  /** Instante en que se puso la contraseña (ISO 8601). */
  setAt: string | null
  status: CredentialStatus
}

/** Texto de CR-11 para cada origen. */
export const CREDENTIAL_SOURCE_LABELS: Record<CredentialSource, string> = {
  created: 'Alta',
  admin_reset: 'Puesta por la administración',
  self_change: 'Cambiada por la persona',
  recovery: 'Recuperada por email',
  initial_delivery: 'Entrega inicial',
}

interface CredentialsPayload {
  email: string | null
  password: string | null
  source: CredentialSource | null
  set_at: string | null
  status: CredentialStatus
}

/**
 * Pide el acceso de una persona. Cada llamada deja un evento
 * `credentials_viewed` en Eventos de seguridad (CR-10), por eso la pantalla
 * la dispara solo a pedido (nunca al abrir la ficha ni por polling).
 */
export async function getCredentials(profileId: string): Promise<Credentials> {
  const data = await invokeAdminUsers<CredentialsPayload>('get_credentials', {
    profile_id: profileId,
  })
  return {
    email: data.email,
    password: data.password,
    source: data.source,
    setAt: data.set_at,
    status: data.status,
  }
}
