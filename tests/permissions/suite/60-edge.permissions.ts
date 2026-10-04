// tests/permissions/suite/60-edge.permissions.ts — TEST-019 (P18.3)
//
// Edge Function `admin-users` (ADR-005, `06_API.md` sección 2.1) por acción y por perfil: JWT
// obligatorio, rol y capacidad del que llama, la jerarquía (un administrador no actúa sobre un
// dueño ni sobre otro administrador), el origen (CORS) y que no se filtren errores internos.
// Todo con cuerpos que no crean ni cambian nada: se detienen en la puerta o en "no encontrado".
// El límite de 10 acciones por minuto no se ejerce en vivo (haría falta ejecutar 10 acciones
// reales sobre cuentas fijas): lo cubre `supabase/functions/admin-users/index.test.ts` y se
// revisa en `docs/security-review.md`.

import { describe, expect, it } from 'vitest'
import { clienteDe, contexto } from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import { llamarEdge, preflight } from './edge-cliente.ts'
import { requireE2eEnv } from '../../fixtures/env.ts'
import { ETIQUETA, PERFILES } from './perfiles.ts'
import { INEXISTENTE } from './rpc.ts'
import { CASOS } from './edge-casos.ts'

describe('Edge Function admin-users por acción y perfil', () => {
  for (const c of CASOS) {
    describe(`acción ${c.accion}`, () => {
      for (const perfil of PERFILES) {
        const hint = c.esperado[perfil]
        caso(
          claveCaso('edge', c.accion, perfil),
          `[${ETIQUETA[perfil]}] admin-users ${c.accion} -> ${hint} (${c.cubre.join(', ')})`,
          async () => {
            const contextoActual = contexto()
            // `anon`: la clave publicable como Bearer (un JWT válido de rol `anon`).
            const token =
              perfil === 'anon'
                ? requireE2eEnv().anonKey
                : contextoActual.tokens[perfil]
            const r = await llamarEdge(token, c.cuerpo(contextoActual))
            expect(r.hint, JSON.stringify(r.cuerpo)).toBe(hint)
          },
        )
      }
    })
  }

  describe('autenticación', () => {
    it('sin cabecera Authorization: 401 (RB-X02)', async () => {
      const r = await llamarEdge(null, {
        action: 'reactivate_user',
        profile_id: INEXISTENTE,
      })
      expect(r.status).toBe(401)
    })

    it('con un JWT inventado: 401 (RB-X02)', async () => {
      const r = await llamarEdge('abc.def.ghi', {
        action: 'reactivate_user',
        profile_id: INEXISTENTE,
      })
      expect(r.status).toBe(401)
    })

    it('con la clave publicable como Bearer (rol anon): 401 UNAUTHENTICATED (RB-X02)', async () => {
      const r = await llamarEdge(requireE2eEnv().anonKey, {
        action: 'reactivate_user',
        profile_id: INEXISTENTE,
      })
      expect(r.status).toBe(401)
      expect(r.hint).toBe('UNAUTHENTICATED')
    })

    it('acción desconocida: 400 UNKNOWN_ACTION, sin detalles internos (RB-X02)', async () => {
      const r = await llamarEdge(contexto().tokens.owner, {
        action: 'borrar_todo',
      })
      expect(r.status).toBe(400)
      expect(r.hint).toBe('UNKNOWN_ACTION')
      expect(JSON.stringify(r.cuerpo)).not.toMatch(
        /stack|at \w+\.|postgres|supabase\.co/i,
      )
    })

    it('cuerpo que no es JSON: 400 y mensaje genérico en español (RB-X02)', async () => {
      const env = requireE2eEnv()
      const respuesta = await fetch(
        `${env.supabaseUrl}/functions/v1/admin-users`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            apikey: env.anonKey,
            Authorization: `Bearer ${contexto().tokens.owner}`,
          },
          body: '{no es json',
        },
      )
      expect(respuesta.status).toBe(400)
      const cuerpo = (await respuesta.json()) as {
        error: { hint: string; message: string }
      }
      expect(cuerpo.error.hint).toBe('VALIDATION_ERROR')
      expect(cuerpo.error.message).not.toMatch(
        /SyntaxError|JSON\.parse|position/i,
      )
    })
  })

  describe('jerarquía: el administrador con manage_users no actúa sobre dueños ni administradores', () => {
    const objetivos: Array<
      [string, (c: ReturnType<typeof contexto>) => string]
    > = [
      ['el dueño', (c) => c.ids.owner],
      ['otro administrador', (c) => c.ids.adminSin],
    ]
    for (const accion of [
      'reset_password',
      'update_email',
      'deactivate_user',
      'sign_out_user',
    ]) {
      for (const [quien, objetivo] of objetivos) {
        it(`[admin con todas] ${accion} sobre ${quien}: FORBIDDEN (RB-A01, RB-X02, CB-17)`, async () => {
          const c = contexto()
          const cuerpo: Record<string, unknown> = {
            action: accion,
            profile_id: objetivo(c),
            new_password: 'Passw0rd-e2e-perm',
            email: 'e2e-perm-nunca@example.com',
            reason: 'e2e-perm',
          }
          const r = await llamarEdge(c.tokens.admin, cuerpo)
          expect(r.hint, JSON.stringify(r.cuerpo)).toBe('FORBIDDEN')
        })
      }
    }

    for (const rolPrivilegiado of ['admin', 'owner']) {
      it(`[admin con todas] create_user con el rol ${rolPrivilegiado}: FORBIDDEN (RB-A01, RB-X02, CB-17)`, async () => {
        const r = await llamarEdge(contexto().tokens.admin, {
          action: 'create_user',
          email: 'e2e-perm-nunca@example.com',
          password: 'Passw0rd-e2e-perm',
          first_name: 'E',
          last_name: 'P',
          roles: [rolPrivilegiado],
        })
        expect(r.hint, JSON.stringify(r.cuerpo)).toBe('FORBIDDEN')
      })
    }
  })

  describe('CORS: orígenes', () => {
    const permitidos = [
      'http://localhost:5173',
      'https://dev.extendiendoservicios.com',
      'https://app.extendiendoservicios.com',
    ]
    for (const origen of permitidos) {
      it(`preflight desde ${origen}: se refleja el origen (RB-X02)`, async () => {
        const r = await preflight(origen)
        expect(r.headers.get('access-control-allow-origin')).toBe(origen)
      })
    }
    for (const origen of [
      'https://evil.example',
      'null',
      'http://localhost:5174',
    ]) {
      it(`preflight desde ${origen}: NO se devuelve Access-Control-Allow-Origin (RB-X02)`, async () => {
        const r = await preflight(origen)
        expect(r.headers.get('access-control-allow-origin')).toBeNull()
      })
      it(`POST con token de dueño desde ${origen}: 403 ORIGIN_NOT_ALLOWED (RB-X02)`, async () => {
        const r = await llamarEdge(
          contexto().tokens.owner,
          { action: 'reactivate_user', profile_id: INEXISTENTE },
          { origen },
        )
        expect(r.status).toBe(403)
        expect(r.hint).toBe('ORIGIN_NOT_ALLOWED')
        expect(r.cabeceras.get('access-control-allow-origin')).toBeNull()
      })
    }
  })

  it('el cliente de la app no puede usar la clave de servicio: la RPC de revocar sesiones no está a su alcance (RB-X02)', async () => {
    const { error } = await clienteDe('owner').rpc(
      'admin_revoke_user_sessions',
      {
        p_profile_id: INEXISTENTE,
      },
    )
    expect(error?.code).toBe('42501')
  })
})
