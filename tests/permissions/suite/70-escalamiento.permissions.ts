// tests/permissions/suite/70-escalamiento.permissions.ts — TEST-019 (P18.3)
//
// Un rol no puede ESCALARSE a sí mismo (CB-17): editar columnas protegidas de su propio
// `profiles`, darse un rol o una capacidad, usar un token falsificado, registrarse como usuario
// nuevo. Además, `anon` solo lee `v_public_branding` (RB-X02) y el cierre de sesión de la
// persona no deja nada abierto. Esperado: `03_Plan_Maestro_Tecnico.md` secciones 6 y 15,
// `04_Modelo_de_Datos.md` sección 7.2 y `06_API.md` sección 2.2.

import { createClient } from '@supabase/supabase-js'
import { createHmac, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Database } from '../../../src/lib/database.types.ts'
import { requireE2eEnv } from '../../fixtures/env.ts'
import { clienteConToken, clienteDe, contexto, servicio } from './contexto.ts'
import { caso, claveCaso } from './defectos.ts'
import { denegado, describir, filas, tabla } from './ayudas.ts'
import { ETIQUETA, type Perfil } from './perfiles.ts'
import { idPerfil } from './tablas.ts'

const SIN_PRIVILEGIOS: Perfil[] = ['empleado', 'supervisor', 'dual']

describe('un perfil no puede escalarse a sí mismo (CB-17)', () => {
  describe('columnas protegidas de su propio profiles', () => {
    const columnas: Array<[string, unknown]> = [
      ['first_name', 'e2e-perm-escalada'],
      ['last_name', 'e2e-perm-escalada'],
      ['is_active', false],
      ['deleted_at', '2099-01-01T00:00:00Z'],
      ['created_by', null],
      ['updated_by', null],
    ]
    for (const perfil of SIN_PRIVILEGIOS) {
      for (const [columna, valor] of columnas) {
        caso(
          claveCaso('escalamiento', 'profiles', columna, perfil),
          `[${ETIQUETA[perfil]}] profiles.update propio de ${columna} -> rechazado (CB-17, RB-X02)`,
          async () => {
            const id = idPerfil(contexto(), perfil)
            const antes = filas(
              await tabla(servicio(), 'profiles').select(columna).eq('id', id),
            )[0]
            const res = await tabla(clienteDe(perfil), 'profiles')
              .update({ [columna]: valor })
              .eq('id', id)
              .select()
            try {
              expect(denegado(res), `se modificó: ${describir(res)}`).toBe(true)
              const despues = filas(
                await tabla(servicio(), 'profiles')
                  .select(columna)
                  .eq('id', id),
              )[0]
              expect(despues).toEqual(antes)
            } finally {
              if (antes)
                await tabla(servicio(), 'profiles').update(antes).eq('id', id)
            }
          },
        )
      }
    }

    for (const perfil of [
      'empleado',
      'supervisor',
      'dual',
      'adminSin',
      'admin',
      'owner',
    ] as Perfil[]) {
      caso(
        claveCaso('escalamiento', 'profiles', 'id', perfil),
        `[${ETIQUETA[perfil]}] profiles.update del id propio (hacerse pasar por otra persona) -> rechazado (CB-17)`,
        async () => {
          const id = idPerfil(contexto(), perfil)
          const res = await tabla(clienteDe(perfil), 'profiles')
            .update({ id: contexto().ids.owner })
            .eq('id', id)
            .select()
          expect(denegado(res), describir(res)).toBe(true)
          expect(res.error?.code).toBe('42501')
        },
      )
    }
  })

  describe('rol y capacidades', () => {
    for (const perfil of [
      ...SIN_PRIVILEGIOS,
      'adminSin',
      'admin',
    ] as Perfil[]) {
      caso(
        claveCaso('escalamiento', 'set_user_roles propio', perfil),
        `[${ETIQUETA[perfil]}] set_user_roles(yo, [owner]) -> FORBIDDEN (CB-17, RB-X02)`,
        async () => {
          const { error } = await clienteDe(perfil).rpc('set_user_roles', {
            p_profile_id: idPerfil(contexto(), perfil),
            p_roles: ['owner'],
          })
          expect(error?.hint, error?.message).toBe('FORBIDDEN')
        },
      )
    }
    for (const perfil of [
      ...SIN_PRIVILEGIOS,
      'adminSin',
      'admin',
    ] as Perfil[]) {
      caso(
        claveCaso('escalamiento', 'set_admin_capability propia', perfil),
        `[${ETIQUETA[perfil]}] set_admin_capability(yo, cualquiera) -> FORBIDDEN: solo el dueño (CB-17, RB-X02)`,
        async () => {
          const { error } = await clienteDe(perfil).rpc(
            'set_admin_capability',
            {
              p_profile_id: idPerfil(contexto(), perfil),
              p_capability: 'manage_users',
              p_enabled: true,
            },
          )
          expect(error?.hint, error?.message).toBe('FORBIDDEN')
        },
      )
    }

    caso(
      claveCaso('escalamiento', 'admin_capabilities propia'),
      '[admin sin capacidades] admin_capabilities.update de su propia capacidad -> rechazado y sin cambios (CB-17)',
      async () => {
        const id = contexto().ids.adminSin
        const res = await tabla(clienteDe('adminSin'), 'admin_capabilities')
          .update({ enabled: true })
          .eq('profile_id', id)
          .eq('capability', 'manage_users')
          .select()
        expect(denegado(res), describir(res)).toBe(true)
        const { data } = await servicio()
          .from('admin_capabilities')
          .select('enabled')
          .eq('profile_id', id)
        expect((data ?? []).every((f) => f.enabled === false)).toBe(true)
      },
    )

    caso(
      claveCaso('escalamiento', 'user_roles propio'),
      '[empleado] user_roles.insert de un rol admin para sí mismo -> rechazado y sin cambios (CB-17)',
      async () => {
        const id = contexto().ids.empleado1
        const res = await tabla(clienteDe('empleado'), 'user_roles')
          .insert({ profile_id: id, role: 'admin' })
          .select()
        expect(denegado(res), describir(res)).toBe(true)
        const { data } = await servicio()
          .from('user_roles')
          .select('role')
          .eq('profile_id', id)
        expect((data ?? []).map((f) => f.role)).toEqual(['employee'])
      },
    )
  })

  describe('token falsificado', () => {
    /** JWT con claims de dueño firmado con una clave inventada: PostgREST tiene que rechazarlo. */
    function tokenFalso(): string {
      const b64 = (o: unknown) =>
        Buffer.from(JSON.stringify(o)).toString('base64url')
      const cabecera = b64({ alg: 'HS256', typ: 'JWT' })
      const ahora = Math.floor(Date.now() / 1000)
      const cuerpo = b64({
        aud: 'authenticated',
        role: 'authenticated',
        sub: contexto().ids.owner,
        roles: ['owner'],
        capabilities: [],
        iat: ahora,
        exp: ahora + 600,
      })
      const firma = createHmac('sha256', randomBytes(32))
        .update(`${cabecera}.${cuerpo}`)
        .digest('base64url')
      return `${cabecera}.${cuerpo}.${firma}`
    }

    it('un JWT de dueño firmado con otra clave no lee nada: 401 (RB-X02)', async () => {
      const db = clienteConToken(tokenFalso())
      const res = await tabla(db, 'security_events').select('*').limit(1)
      expect(res.error, describir(res)).not.toBeNull()
      expect(filas(res)).toEqual([])
    })

    it('un JWT de dueño firmado con otra clave no ejecuta RPC: 401 (RB-X02)', async () => {
      const db = clienteConToken(tokenFalso())
      const { error } = await db.rpc('set_admin_capability', {
        p_profile_id: contexto().ids.adminSin,
        p_capability: 'manage_users',
        p_enabled: true,
      })
      expect(error).not.toBeNull()
      expect(error?.hint).not.toBe('ADMIN_ROLE_REQUIRED')
    })

    it('un JWT de dueño firmado con otra clave no pasa la Edge Function (RB-X02)', async () => {
      const env = requireE2eEnv()
      const respuesta = await fetch(
        `${env.supabaseUrl}/functions/v1/admin-users`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: env.anonKey,
            Authorization: `Bearer ${tokenFalso()}`,
          },
          body: JSON.stringify({
            action: 'reactivate_user',
            profile_id: contexto().ids.adminSin,
          }),
        },
      )
      expect(respuesta.status).toBe(401)
    })
  })
})

describe('anon y el registro de personas', () => {
  const anonimo = () => {
    const env = requireE2eEnv()
    return createClient<Database>(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  it('el registro abierto está apagado: signUp se rechaza y no crea ninguna cuenta (RB-A01, RB-X02)', async () => {
    const email = 'e2e-perm-registro@example.com'
    const { data, error } = await anonimo().auth.signUp({
      email,
      password: 'Passw0rd-e2e-perm',
    })
    expect(error, 'el registro público respondió sin error').not.toBeNull()
    expect(data.user).toBeNull()
    const { data: lista } = await servicio().auth.admin.listUsers({
      perPage: 1000,
    })
    expect((lista?.users ?? []).some((u) => u.email === email)).toBe(false)
  })

  it('un código por email no crea cuentas nuevas (RB-X02)', async () => {
    const email = 'e2e-perm-otp@example.com'
    const { error } = await anonimo().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    expect(
      error,
      'el inicio por código creó o aceptó una cuenta nueva',
    ).not.toBeNull()
  })

  it('recuperar contraseña de un email que no existe no revela nada: sin error (03 §15)', async () => {
    const { error } = await anonimo().auth.resetPasswordForEmail(
      'e2e-perm-no-existe@example.com',
      { redirectTo: 'http://localhost:5173/restablecer' },
    )
    expect(error, error?.message).toBeNull()
  })

  it('anon no ve ninguna tabla ni RPC de negocio: solo v_public_branding (RB-X02)', async () => {
    const db = anonimo()
    const lectura = await tabla(db, 'v_public_branding').select('*')
    expect(lectura.error).toBeNull()
    const res = await tabla(db, 'profiles').select('*').limit(1)
    expect(res.error?.code).toBe('42501')
    const rpc = await db.rpc('mark_changes_seen')
    expect(rpc.error?.code).toBe('42501')
  })

  it('anon no puede leer con un token de usuario vencido o ajeno inventado (RB-X02)', async () => {
    const res = await tabla(
      clienteConToken('eyJhbGciOiJIUzI1NiJ9.e30.firma'),
      'profiles',
    )
      .select('*')
      .limit(1)
    expect(res.error).not.toBeNull()
  })
})
