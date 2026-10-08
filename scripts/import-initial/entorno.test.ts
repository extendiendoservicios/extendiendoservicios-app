// @vitest-environment node
// DATA-005: el importador elige el entorno de forma explícita y se niega a tocar producción.

import { describe, expect, it } from 'vitest'
import {
  ErrorDeEntorno,
  REF_APP,
  REF_APP_DEV,
  refDeClave,
  refDeUrl,
  resolverConexion,
} from './entorno.ts'

const urlDev = `https://${REF_APP_DEV}.supabase.co`
const urlProd = `https://${REF_APP}.supabase.co`
const base = { SUPABASE_SERVICE_ROLE_KEY: 'clave-falsa-de-prueba' }

describe('resolverConexion', () => {
  it('sin IMPORT_ENTORNO se niega, aunque la URL sea válida', () => {
    expect(() =>
      resolverConexion(
        { ...base, VITE_SUPABASE_URL: urlDev },
        { permitirProduccionF20: false },
      ),
    ).toThrow(ErrorDeEntorno)
  })

  it('app_dev con la URL de App_dev funciona', () => {
    const c = resolverConexion(
      { ...base, IMPORT_ENTORNO: 'app_dev', VITE_SUPABASE_URL: urlDev },
      { permitirProduccionF20: false },
    )
    expect(c.entorno).toBe('app_dev')
    expect(c.ref).toBe(REF_APP_DEV)
  })

  it('app_dev con la URL de producción se corta', () => {
    expect(() =>
      resolverConexion(
        { ...base, IMPORT_ENTORNO: 'app_dev', VITE_SUPABASE_URL: urlProd },
        { permitirProduccionF20: true },
      ),
    ).toThrow(/PRODUCCIÓN/)
  })

  it('app (producción) se niega sin la bandera de F20, aunque la URL coincida', () => {
    expect(() =>
      resolverConexion(
        { ...base, IMPORT_ENTORNO: 'app', VITE_SUPABASE_URL: urlProd },
        { permitirProduccionF20: false },
      ),
    ).toThrow(/permitir-produccion-f20/)
  })

  it('app con la bandera de F20 y la URL de producción funciona', () => {
    const c = resolverConexion(
      { ...base, IMPORT_ENTORNO: 'app', VITE_SUPABASE_URL: urlProd },
      { permitirProduccionF20: true },
    )
    expect(c.entorno).toBe('app')
  })

  it('app con la bandera pero apuntando a App_dev también se corta', () => {
    expect(() =>
      resolverConexion(
        { ...base, IMPORT_ENTORNO: 'app', VITE_SUPABASE_URL: urlDev },
        { permitirProduccionF20: true },
      ),
    ).toThrow(ErrorDeEntorno)
  })

  it('una URL de otro proyecto o sin formato se corta', () => {
    expect(() =>
      resolverConexion(
        {
          ...base,
          IMPORT_ENTORNO: 'app_dev',
          VITE_SUPABASE_URL: 'https://otro.supabase.co',
        },
        { permitirProduccionF20: false },
      ),
    ).toThrow(ErrorDeEntorno)
    expect(() =>
      resolverConexion(
        {
          ...base,
          IMPORT_ENTORNO: 'app_dev',
          VITE_SUPABASE_URL: 'no-es-una-url',
        },
        { permitirProduccionF20: false },
      ),
    ).toThrow(ErrorDeEntorno)
  })

  it('una clave de servicio JWT de otro proyecto se corta', () => {
    const payload = Buffer.from(JSON.stringify({ ref: REF_APP })).toString(
      'base64url',
    )
    const clave = `cabecera.${payload}.firma`
    expect(refDeClave(clave)).toBe(REF_APP)
    expect(() =>
      resolverConexion(
        {
          IMPORT_ENTORNO: 'app_dev',
          VITE_SUPABASE_URL: urlDev,
          SUPABASE_SERVICE_ROLE_KEY: clave,
        },
        { permitirProduccionF20: false },
      ),
    ).toThrow(/otro proyecto/)
  })

  it('faltan las credenciales', () => {
    expect(() =>
      resolverConexion(
        { IMPORT_ENTORNO: 'app_dev' },
        { permitirProduccionF20: false },
      ),
    ).toThrow(/Faltan/)
  })
})

describe('refDeUrl', () => {
  it('extrae el ref', () => {
    expect(refDeUrl(urlDev)).toBe(REF_APP_DEV)
    expect(refDeUrl('https://ejemplo.com')).toBeNull()
  })
})
