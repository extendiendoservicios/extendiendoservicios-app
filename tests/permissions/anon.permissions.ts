// tests/permissions/anon.permissions.ts — P04.7 (08_Fases_y_Backlog.md, F4)
//
// Criterio del paquete P04.7 (11_Desglose_de_Tareas.md): "anon solo v_public_branding". El
// modelo lo precisa en 04_Modelo_de_Datos.md sección 7.2 (cierre): "revoke all on all tables
// from anon; anon solo accede a v_public_branding" -- y sección 7.2 fila company_settings:
// "anon solo name, logo_path, support_phone vía vista v_public_branding para el login".

import { describe, expect, it } from 'vitest'
import { createAnonClient } from './helpers/clients.ts'
import { missingEnvWarning, readPermissionsTestEnv } from './helpers/env.ts'

const env = readPermissionsTestEnv()
if (!env) console.warn(missingEnvWarning('anon.permissions.ts'))

describe.skipIf(!env)(
  'rol anon — permisos por API directa contra App_dev',
  () => {
    describe('lo que SÍ puede hacer', () => {
      it('RB-X02: lee la marca pública en v_public_branding (nombre, logo, teléfono de soporte)', async () => {
        const anon = createAnonClient()
        const { data, error } = await anon.from('v_public_branding').select('*')
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(data?.[0]).toHaveProperty('name')
        expect(data?.[0]).toHaveProperty('logo_path')
        expect(data?.[0]).toHaveProperty('support_phone')
      })
    })

    describe('lo que NO puede hacer (nada más que v_public_branding)', () => {
      it('no puede leer todas las columnas de company_settings (0017_grants.sql solo le da 4 columnas puntuales)', async () => {
        const anon = createAnonClient()
        const { error } = await anon.from('company_settings').select('*')
        expect(error?.code).toBe('42501')
      })

      it('no puede leer profiles', async () => {
        const anon = createAnonClient()
        const { error } = await anon.from('profiles').select('*')
        expect(error?.code).toBe('42501')
      })

      it('no puede leer ninguna otra vista de negocio (v_employees)', async () => {
        const anon = createAnonClient()
        const { error } = await anon.from('v_employees').select('*')
        expect(error?.code).toBe('42501')
      })

      it('no puede leer holidays', async () => {
        const anon = createAnonClient()
        const { error } = await anon.from('holidays').select('*')
        expect(error?.code).toBe('42501')
      })

      it('no puede llamar ninguna RPC (mark_changes_seen)', async () => {
        const anon = createAnonClient()
        const { error } = await anon.rpc('mark_changes_seen')
        expect(error?.code).toBe('42501')
      })

      it('no puede llamar set_user_roles', async () => {
        const anon = createAnonClient()
        const { error } = await anon.rpc('set_user_roles', {
          p_profile_id: '00000000-0000-0000-0000-000000000000',
          p_roles: ['employee'],
        })
        expect(error?.code).toBe('42501')
      })
    })
  },
)
