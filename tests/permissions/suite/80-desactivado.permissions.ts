// tests/permissions/suite/80-desactivado.permissions.ts — TEST-019 (P18.3)
//
// Una persona desactivada no puede hacer NADA con un token que todavía no venció. Con
// `jwt_expiry = 900` (15 minutos) un `access_token` ya emitido sigue siendo válido para
// PostgREST (se valida por firma y vencimiento) aunque la cuenta se haya dado de baja; por eso
// las políticas y las RPC consultan el perfil EN VIVO (`app.current_profile_active()`, 0020 y
// 0022). Acá se toma el token de cada perfil (emitido al empezar la corrida, con sus roles
// completos), se desactiva el perfil con la clave de servicio (sin tocar las sesiones, igual que
// la ventana real: la baja revoca los refresh tokens pero no el access token vigente) y se
// intenta leer, escribir y llamar todo. Después se reactiva. Cubre CB-18, RB-A02, RB-X02 y el
// flujo crítico 1 de `03` sección 14.2.
//
// Perfiles: empleado, supervisor y administrador con todas las capacidades. El dueño no se
// prueba (desactivarlo, aunque fuera por un instante, pondría en riesgo el último dueño).

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../../src/lib/database.types.ts'
import { requireE2eEnv } from '../../fixtures/env.ts'
import { clienteConToken, contexto, servicio, type Db } from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import { denegado, describir, filas, tabla } from './ayudas.ts'
import { llamarEdge } from './edge-cliente.ts'
import { CASOS_RPC } from './rpc.ts'
import { TABLAS } from './tablas.ts'
import { VISTAS } from './vistas.ts'
import { idPerfil } from './tablas.ts'
import type { Perfil } from './perfiles.ts'
import { ETIQUETA } from './perfiles.ts'

const PERFILES_A_DESACTIVAR: Array<
  Extract<Perfil, 'empleado' | 'supervisor' | 'admin'>
> = ['empleado', 'supervisor', 'admin']

/** Tablas que cualquier persona con sesión lee por diseño (04 §7.2: "todos autenticados"). */
const LEIBLES_POR_TODOS = ['holidays', 'company_settings']

for (const perfil of PERFILES_A_DESACTIVAR) {
  describe(`desactivado: ${ETIQUETA[perfil]} con el token todavía vigente`, () => {
    let db: Db
    let token: string
    let id: string

    beforeAll(async () => {
      const c = contexto()
      token = c.tokens[perfil]
      id = idPerfil(c, perfil)
      db = clienteConToken(token)
      // Control: ANTES de la baja el token funciona (si no, lo que sigue no probaría nada).
      const propio = await tabla(db, 'profiles').select('id').eq('id', id)
      expect(propio.error, describir(propio)).toBeNull()
      expect(
        filas(propio),
        'el token no sirve ni antes de la baja',
      ).toHaveLength(1)

      const { error } = await servicio()
        .from('profiles')
        .update({ is_active: false })
        .eq('id', id)
      expect(error, error?.message).toBeNull()
    })

    afterAll(async () => {
      await servicio()
        .from('profiles')
        .update({ is_active: true, deleted_at: null })
        .eq('id', idPerfil(contexto(), perfil))
    })

    if (perfil === 'empleado') {
      it('al renovar la sesión, el token nuevo viene sin roles ni capacidades y no sirve para nada (CB-18, 04 §7.1)', async () => {
        const env = requireE2eEnv()
        const c = contexto()
        const sesion = createClient<Database>(env.supabaseUrl, env.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        await sesion.auth.setSession({
          access_token: c.tokens.empleado,
          refresh_token: c.refreshEmpleado,
        })
        const { data, error } = await sesion.auth.refreshSession()
        expect(error, error?.message).toBeNull()
        const nuevo = data.session?.access_token ?? ''
        const carga = JSON.parse(
          Buffer.from(nuevo.split('.')[1], 'base64url').toString('utf8'),
        ) as { roles?: string[]; capabilities?: string[] }
        expect(carga.roles).toEqual([])
        expect(carga.capabilities).toEqual([])
        const res = await tabla(clienteConToken(nuevo), 'profiles')
          .select('id')
          .limit(1)
        expect(filas(res)).toEqual([])
      })
    }

    it('no ve ni su propia fila de profiles (CB-18, RB-X02)', async () => {
      const res = await tabla(db, 'profiles').select('id').eq('id', id)
      expect(res.error, describir(res)).toBeNull()
      expect(filas(res)).toEqual([])
    })

    for (const spec of TABLAS) {
      const permitidoPorTodos = LEIBLES_POR_TODOS.includes(spec.tabla)
      caso(
        claveCaso('desactivado', spec.tabla, 'select', perfil),
        `${spec.tabla}.select -> cero filas (CB-18, RB-X02)`,
        async () => {
          const consulta = tabla(db, spec.tabla).select('*')
          const res = await (spec.pesada
            ? consulta.in(spec.clave, Object.values(spec.filas(contexto())))
            : consulta.limit(5))
          expect(res.error, describir(res)).toBeNull()
          expect(
            filas(res),
            permitidoPorTodos
              ? 'una cuenta desactivada sigue leyendo esta tabla'
              : `${spec.tabla} devolvió filas`,
          ).toEqual([])
        },
      )
    }

    for (const spec of VISTAS) {
      if (spec.vista === 'v_public_branding') continue
      caso(
        claveCaso('desactivado', spec.vista, 'select', perfil),
        `${spec.vista}.select -> cero filas (CB-18, RB-X02)`,
        async () => {
          const res = await tabla(db, spec.vista).select('*').limit(5)
          expect(res.error, describir(res)).toBeNull()
          expect(filas(res), `${spec.vista} devolvió filas`).toEqual([])
        },
      )
    }

    // Todas las RPC a las que este perfil ENTRABA, ahora cerradas.
    for (const c of CASOS_RPC) {
      const antes = c.esperado[perfil]
      if (antes === 'FORBIDDEN' || antes === '42501') continue
      const nombre = c.variante ? `${c.rpc} (${c.variante})` : c.rpc
      caso(
        claveCaso('desactivado', 'rpc', nombre, perfil),
        `${nombre} -> FORBIDDEN (CB-18, RB-X02)`,
        async () => {
          const { error } = await db.rpc(
            c.rpc as 'mark_changes_seen',
            c.args(contexto(), perfil) as never,
          )
          expect(error?.hint ?? error?.code ?? 'OK', error?.message).toBe(
            'FORBIDDEN',
          )
        },
      )
    }

    // Todo lo que este perfil podía insertar, ahora cerrado.
    for (const spec of TABLAS) {
      if (!spec.insert.permitido.includes(perfil)) continue
      caso(
        claveCaso('desactivado', spec.tabla, 'insert', perfil),
        `${spec.tabla}.insert -> rechazado (CB-18, RB-X02)`,
        async () => {
          const res = await tabla(db, spec.tabla)
            .insert(spec.insert.fila(contexto(), perfil))
            .select()
          const creadas = filas(res)
          try {
            expect(denegado(res), `se creó una fila: ${describir(res)}`).toBe(
              true,
            )
          } finally {
            for (const fila of creadas) {
              let q = tabla(servicio(), spec.tabla).delete()
              for (const col of spec.pk) q = q.eq(col, fila[col])
              await q
            }
          }
        },
      )
    }

    caso(
      claveCaso('desactivado', 'profiles', 'update propio', perfil),
      'profiles.update de su propio teléfono -> rechazado (CB-18, RB-X02)',
      async () => {
        const res = await tabla(db, 'profiles')
          .update({ phone: '1100009999' })
          .eq('id', id)
          .select()
        expect(denegado(res), describir(res)).toBe(true)
      },
    )

    caso(
      claveCaso('desactivado', 'edge', 'create_user', perfil),
      'admin-users: la Edge Function lo rechaza con FORBIDDEN (CB-18, RB-X02)',
      async () => {
        const r = await llamarEdge(token, {
          action: 'create_user',
          email: 'e2e-perm-nunca@example.com',
          password: 'Passw0rd-e2e-perm',
          first_name: 'E',
          last_name: 'P',
          roles: ['employee'],
        })
        expect(r.hint, JSON.stringify(r.cuerpo)).toBe('FORBIDDEN')
      },
    )

    caso(
      claveCaso('desactivado', 'storage', 'avatars', perfil),
      'avatars: no puede subir una foto a su carpeta (CB-18, RB-X02)',
      async () => {
        const ruta = `${id}/e2e-perm-desactivado-${perfil}.jpg`
        const jpeg = new Uint8Array([
          0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0,
          1, 0, 1, 0, 0, 0xff, 0xd9,
        ])
        const { error } = await db.storage
          .from('avatars')
          .upload(ruta, jpeg, { contentType: 'image/jpeg', upsert: true })
        // Si se subió (defecto), se borra.
        if (!error) await servicio().storage.from('avatars').remove([ruta])
        expect(
          error?.message,
          'una cuenta desactivada pudo subir un archivo',
        ).toMatch(/row-level security/i)
      },
    )
  })
}

describe('la ventana del token vigente está acotada', () => {
  it('jwt_expiry = 900: el access token vive como mucho 15 minutos (03 §15, CB-18)', () => {
    const c = contexto()
    const carga = JSON.parse(
      Buffer.from(c.tokens.empleado.split('.')[1], 'base64url').toString(
        'utf8',
      ),
    ) as { roles?: string[]; exp: number; iat: number }
    expect(carga.roles).toEqual(['employee'])
    expect(carga.exp - carga.iat).toBeLessThanOrEqual(900)
  })
})
