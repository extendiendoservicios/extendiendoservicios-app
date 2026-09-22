import { describe, expect, it } from 'vitest'
import { decodeAccessTokenClaims } from './claims'

/** Arma un JWT de prueba (header cualquiera, payload real, firma falsa). */
function fakeToken(claims: Record<string, unknown>): string {
  const payload = base64Url(JSON.stringify(claims))
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.firma-falsa`
}

function base64Url(json: string): string {
  // btoa produce base64 estándar; los `+`/`/` se cambian a `-`/`_` (base64url,
  // RFC 4648 §5, el que usan los JWT de verdad) y se saca el `=` de relleno
  // -- `decodeAccessTokenClaims` tiene que poder leer los dos formatos.
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('decodeAccessTokenClaims', () => {
  it('lee roles y capacidades de un token válido (formato base64url real)', () => {
    const token = fakeToken({
      roles: ['owner', 'admin'],
      capabilities: ['manage_users'],
    })

    expect(decodeAccessTokenClaims(token)).toEqual({
      roles: ['owner', 'admin'],
      capabilities: ['manage_users'],
    })
  })

  it('descarta valores de rol que no son app_role', () => {
    const token = fakeToken({
      roles: ['employee', 'inventado', 42],
      capabilities: [],
    })

    expect(decodeAccessTokenClaims(token).roles).toEqual(['employee'])
  })

  it('sin claim roles/capabilities, devuelve arreglos vacíos', () => {
    const token = fakeToken({ sub: 'user-1' })

    expect(decodeAccessTokenClaims(token)).toEqual({
      roles: [],
      capabilities: [],
    })
  })

  it('sin token, devuelve arreglos vacíos', () => {
    expect(decodeAccessTokenClaims(undefined)).toEqual({
      roles: [],
      capabilities: [],
    })
  })

  it('con un token malformado (sin segmentos), devuelve arreglos vacíos en vez de lanzar', () => {
    expect(decodeAccessTokenClaims('esto-no-es-un-jwt')).toEqual({
      roles: [],
      capabilities: [],
    })
  })

  it('con un payload que no es JSON válido, devuelve arreglos vacíos en vez de lanzar', () => {
    const token = `eyJhbGciOiJIUzI1NiJ9.${base64Url('{no es json')}.firma-falsa`

    expect(decodeAccessTokenClaims(token)).toEqual({
      roles: [],
      capabilities: [],
    })
  })
})
