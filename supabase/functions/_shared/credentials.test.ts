// Tests Deno de `_shared/credentials.ts` (P26.1, CR-09): cifrado AES-256-GCM de ida y vuelta, IV
// distinto en cada cifrado y fallo limpio (sin devolver basura) con otra clave, dato alterado o
// clave ausente. Las claves se generan acá: nunca se usa una real.
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from 'jsr:@std/assert@1'
import {
  CURRENT_KEY_VERSION,
  CredentialsError,
  decrypt,
  encrypt,
} from './credentials.ts'

function nuevaClave(bytes = 32): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))),
  )
}

async function codigoDeError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    if (e instanceof CredentialsError) return e.code
    throw e
  }
  throw new Error('se esperaba un CredentialsError')
}

Deno.test(
  'encrypt y decrypt: ida y vuelta, con tildes y símbolos',
  async () => {
    const clave = nuevaClave()
    for (const clear of [
      'Clave-123!',
      'contraseña ñandú ✓ 日本',
      'a'.repeat(200),
    ]) {
      const sellado = await encrypt(clear, clave)
      assertEquals(sellado.keyVersion, CURRENT_KEY_VERSION)
      assert(!atob(sellado.ciphertext).includes(clear))
      assertEquals(await decrypt(sellado, clave), clear)
    }
  },
)

Deno.test(
  'encrypt: IV de 12 bytes y distinto en cada cifrado, aunque el texto sea igual',
  async () => {
    const clave = nuevaClave()
    const a = await encrypt('misma-clave-1', clave)
    const b = await encrypt('misma-clave-1', clave)
    assertEquals(atob(a.iv).length, 12)
    assertNotEquals(a.iv, b.iv)
    assertNotEquals(a.ciphertext, b.ciphertext)
  },
)

Deno.test(
  'decrypt con una clave equivocada falla limpio (DECRYPT_FAILED), sin devolver nada',
  async () => {
    const sellado = await encrypt('secreta-1234', nuevaClave())
    assertEquals(
      await codigoDeError(() => decrypt(sellado, nuevaClave())),
      'DECRYPT_FAILED',
    )
  },
)

Deno.test(
  'decrypt de un dato alterado o con IV roto falla limpio',
  async () => {
    const clave = nuevaClave()
    const sellado = await encrypt('secreta-1234', clave)
    const bytes = Uint8Array.from(atob(sellado.ciphertext), (c) =>
      c.charCodeAt(0),
    )
    bytes[0] ^= 1
    const alterado = {
      ...sellado,
      ciphertext: btoa(String.fromCharCode(...bytes)),
    }
    assertEquals(
      await codigoDeError(() => decrypt(alterado, clave)),
      'DECRYPT_FAILED',
    )
    assertEquals(
      await codigoDeError(() =>
        decrypt({ ...sellado, iv: btoa('corto') }, clave),
      ),
      'DECRYPT_FAILED',
    )
    assertEquals(
      await codigoDeError(() =>
        decrypt({ ...sellado, iv: '%%%no-es-base64' }, clave),
      ),
      'DECRYPT_FAILED',
    )
  },
)

Deno.test(
  'decrypt de una versión de clave que no existe: UNSUPPORTED_KEY_VERSION',
  async () => {
    const clave = nuevaClave()
    const sellado = await encrypt('secreta-1234', clave)
    assertEquals(
      await codigoDeError(() => decrypt({ ...sellado, keyVersion: 2 }, clave)),
      'UNSUPPORTED_KEY_VERSION',
    )
  },
)

Deno.test(
  'clave ausente o inválida: error claro, nunca un cifrado débil',
  async () => {
    const anterior = Deno.env.get('CREDENTIALS_KEY')
    try {
      Deno.env.delete('CREDENTIALS_KEY')
      assertEquals(
        await codigoDeError(() => encrypt('x-secreta-12')),
        'KEY_MISSING',
      )
      Deno.env.set('CREDENTIALS_KEY', '   ')
      assertEquals(
        await codigoDeError(() => encrypt('x-secreta-12')),
        'KEY_MISSING',
      )
      assertEquals(
        await codigoDeError(() => encrypt('x-secreta-12', nuevaClave(16))),
        'KEY_INVALID',
      )
      assertEquals(
        await codigoDeError(() => encrypt('x-secreta-12', '%%%no-es-base64')),
        'KEY_INVALID',
      )
      // Lee la clave del entorno cuando no se pasa explícita.
      Deno.env.set('CREDENTIALS_KEY', nuevaClave())
      const sellado = await encrypt('del-entorno-1')
      assertEquals(await decrypt(sellado), 'del-entorno-1')
    } finally {
      if (anterior === undefined) Deno.env.delete('CREDENTIALS_KEY')
      else Deno.env.set('CREDENTIALS_KEY', anterior)
    }
  },
)

Deno.test(
  'los mensajes de error no contienen la contraseña ni el texto cifrado',
  async () => {
    const clave = nuevaClave()
    const sellado = await encrypt('contraseña-que-no-debe-filtrarse', clave)
    const err = await assertRejects(
      () => decrypt(sellado, nuevaClave()),
      CredentialsError,
    )
    assert(!err.message.includes('contraseña-que-no-debe-filtrarse'))
    assert(!err.message.includes(sellado.ciphertext))
  },
)
