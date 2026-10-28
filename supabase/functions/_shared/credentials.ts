// Cifrado de la copia de contraseñas (P26.1, CR-09).
//
// AES-256-GCM con Web Crypto. Un IV aleatorio de 12 bytes por cada cifrado. La clave es un
// secreto de la función (`CREDENTIALS_KEY`, 32 bytes en base64 estándar) y se lee de `Deno.env`
// recién cuando se la necesita. `key_version` permite rotarla: hoy existe solo la versión 1.
//
// Reglas de seguridad de este módulo:
//   - Nunca devuelve basura: si la clave falta, es inválida, es otra o el dato se alteró, lanza
//     `CredentialsError` (GCM autentica el texto cifrado: con una clave equivocada falla, no
//     descifra algo ilegible).
//   - Nunca pone una contraseña, un texto cifrado ni la clave en un mensaje de error o un log.
//   - Solo lo usa la Edge Function `admin-users` (y, por CR-15, el script de entrega de
//     credenciales). La base de datos guarda únicamente `ciphertext` e `iv` en base64.

/** Versión de clave con la que se cifra hoy. */
export const CURRENT_KEY_VERSION = 1

export type CredentialsErrorCode =
  'KEY_MISSING' | 'KEY_INVALID' | 'UNSUPPORTED_KEY_VERSION' | 'DECRYPT_FAILED'

export class CredentialsError extends Error {
  constructor(
    public readonly code: CredentialsErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CredentialsError'
  }
}

export interface SealedPassword {
  /** Texto cifrado (con la etiqueta de autenticación de GCM al final), en base64. */
  ciphertext: string
  /** Vector de inicialización de 12 bytes, en base64. */
  iv: string
  keyVersion: number
}

const IV_BYTES = 12
const KEY_BYTES = 32

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Importa la clave (secreto `CREDENTIALS_KEY` o la que se pase explícita, para los tests). */
async function importKey(keyBase64?: string): Promise<CryptoKey> {
  const raw = keyBase64 ?? Deno.env.get('CREDENTIALS_KEY')
  if (!raw || raw.trim() === '') {
    throw new CredentialsError(
      'KEY_MISSING',
      'Falta el secreto CREDENTIALS_KEY de la función.',
    )
  }
  let bytes: Uint8Array
  try {
    bytes = fromBase64(raw.trim())
  } catch {
    throw new CredentialsError(
      'KEY_INVALID',
      'CREDENTIALS_KEY no es un base64 válido.',
    )
  }
  if (bytes.length !== KEY_BYTES) {
    throw new CredentialsError(
      'KEY_INVALID',
      `CREDENTIALS_KEY tiene que tener ${KEY_BYTES} bytes (tiene ${bytes.length}).`,
    )
  }
  return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

/** Cifra `plaintext` con un IV nuevo. Lanza `CredentialsError` si la clave falta o no sirve. */
export async function encrypt(
  plaintext: string,
  keyBase64?: string,
): Promise<SealedPassword> {
  const key = await importKey(keyBase64)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    ciphertext: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
    keyVersion: CURRENT_KEY_VERSION,
  }
}

/** Descifra. Lanza `CredentialsError` ante cualquier problema; nunca devuelve un texto dudoso. */
export async function decrypt(
  sealed: SealedPassword,
  keyBase64?: string,
): Promise<string> {
  if (sealed.keyVersion !== CURRENT_KEY_VERSION) {
    throw new CredentialsError(
      'UNSUPPORTED_KEY_VERSION',
      `No hay clave para la versión ${sealed.keyVersion}.`,
    )
  }
  const key = await importKey(keyBase64)
  try {
    const iv = fromBase64(sealed.iv)
    if (iv.length !== IV_BYTES) {
      throw new Error('iv de largo inesperado')
    }
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      fromBase64(sealed.ciphertext),
    )
    return new TextDecoder('utf-8', { fatal: true }).decode(decrypted)
  } catch {
    // Sin detalle del error original a propósito: no hay nada útil que loguear y el mensaje de
    // las rutas internas de Web Crypto no tiene que filtrarse.
    throw new CredentialsError(
      'DECRYPT_FAILED',
      'No se pudo descifrar la copia guardada (clave distinta o dato alterado).',
    )
  }
}
