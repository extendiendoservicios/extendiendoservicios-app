// tests/permissions/suite/61-edge-evidence-cleanup.permissions.ts — P21.6c (módulo H, H-08)
//
// Edge Function `evidence-cleanup` (borrado nocturno de evidencia vencida), por HTTP directo
// contra App_dev. La dispara un workflow programado, no una persona: no se autentica con el JWT
// de un usuario sino con el secreto del encabezado `x-evidence-cleanup-secret` (verify_jwt = false).
// Lo que se prueba es la puerta, sin el secreto verdadero (la matriz nunca lo conoce): ningún perfil
// puede hacerla correr, ni siquiera el dueño. Nada de lo que se llama acá borra o cambia algo.
//
// Respuestas esperadas (`supabase/functions/evidence-cleanup/index.ts`):
//   - método distinto de POST            -> 405 METHOD_NOT_ALLOWED
//   - sin el encabezado o con uno falso  -> 401 UNAUTHORIZED
//   - función sin secreto configurado    -> 500 NOT_CONFIGURED (falla cerrada; no se espera en App_dev)

import { describe, expect, it } from 'vitest'
import { requireE2eEnv } from '../../fixtures/env.ts'
import { contexto } from './contexto.ts'
import { ETIQUETA, PERFILES } from './perfiles.ts'

const ENCABEZADO = 'x-evidence-cleanup-secret'

async function llamar(opciones: {
  metodo?: string
  token?: string | null
  secreto?: string
}) {
  const env = requireE2eEnv()
  const cabeceras: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: env.anonKey,
  }
  if (opciones.token) cabeceras.Authorization = `Bearer ${opciones.token}`
  if (opciones.secreto !== undefined) cabeceras[ENCABEZADO] = opciones.secreto
  const r = await fetch(`${env.supabaseUrl}/functions/v1/evidence-cleanup`, {
    method: opciones.metodo ?? 'POST',
    headers: cabeceras,
    ...((opciones.metodo ?? 'POST') === 'POST' ? { body: '{}' } : {}),
  })
  const texto = await r.text()
  let cuerpo: { code?: string } = {}
  try {
    cuerpo = JSON.parse(texto) as { code?: string }
  } catch {
    // La puerta devolvió algo que no es JSON: queda en el mensaje del expect.
  }
  return { status: r.status, code: cuerpo.code, texto }
}

describe('Edge Function evidence-cleanup: la puerta es el secreto (H-08, RB-X02)', () => {
  for (const perfil of PERFILES) {
    it(`[${ETIQUETA[perfil]}] su sesión no alcanza: sin el secreto, 401 UNAUTHORIZED`, async () => {
      const token = perfil === 'anon' ? null : contexto().tokens[perfil]
      const r = await llamar({ token })
      expect(r.texto).toContain('UNAUTHORIZED')
      expect(r.status).toBe(401)
      expect(r.code).toBe('UNAUTHORIZED')
    })
  }

  it('con un secreto falso: 401 UNAUTHORIZED', async () => {
    const r = await llamar({ secreto: 'falso-e2e-perm' })
    expect(r.status, r.texto).toBe(401)
    expect(r.code).toBe('UNAUTHORIZED')
  })

  it('con un secreto falso y la sesión del dueño: 401 UNAUTHORIZED (el rol no reemplaza al secreto)', async () => {
    const r = await llamar({
      token: contexto().tokens.owner,
      secreto: 'falso-e2e-perm',
    })
    expect(r.status, r.texto).toBe(401)
    expect(r.code).toBe('UNAUTHORIZED')
  })

  it('con el encabezado vacío: 401 UNAUTHORIZED', async () => {
    const r = await llamar({ secreto: '' })
    expect(r.status, r.texto).toBe(401)
  })

  it('un GET no hace nada: 405 METHOD_NOT_ALLOWED', async () => {
    const r = await llamar({ metodo: 'GET' })
    expect(r.status, r.texto).toBe(405)
    expect(r.code).toBe('METHOD_NOT_ALLOWED')
  })

  it('un DELETE no hace nada: 405 METHOD_NOT_ALLOWED', async () => {
    const r = await llamar({ metodo: 'DELETE' })
    expect(r.status, r.texto).toBe(405)
    expect(r.code).toBe('METHOD_NOT_ALLOWED')
  })
})
