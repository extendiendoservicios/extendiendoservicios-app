// tests/permissions/admin.permissions.ts — P04.7 (08_Fases_y_Backlog.md, F4)
//
// "Si te da el tiempo, sumá supervisora y administradora con el mismo criterio: lo que puede y
// lo que no" (encargo P04.7). Tratamiento representativo, no exhaustivo (igual que
// employee.permissions.ts y supervisor.permissions.ts): la suite completa es TEST-019 (F18).
//
// Administradora: andrea.rios, que en el seed tiene las 7 capacidades (owner, administradora,
// 7 capacidades, según el encargo). El interés de esta suite NO es "admin puede casi todo" (eso
// ya lo demuestran los positivos), sino el límite real: ni siquiera con las 7 capacidades deja
// de ser `admin` -- las acciones reservadas a `owner` (04 sección 7.2 y 06_API.md) siguen
// negadas. Por eso los negativos de este archivo son justo esas acciones "solo owner", no
// acciones para las que a Andrea directamente le falte una capacidad (ese caso, más
// interesante para una cuenta admin SIN todas las capacidades, queda para TEST-019/F18: hoy el
// seed no tiene una segunda cuenta admin con capacidades parciales para probarlo).

import { beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminClient,
  loginAs,
  type TestClient,
} from './helpers/clients.ts'
import { resolveUserId } from './helpers/admin-lookups.ts'
import { missingEnvWarning, readPermissionsTestEnv } from './helpers/env.ts'
import { SEED_ACCOUNTS } from './fixtures/seed-accounts.ts'

const env = readPermissionsTestEnv()
if (!env) console.warn(missingEnvWarning('admin.permissions.ts'))

describe.skipIf(!env)(
  'rol admin (no owner) — permisos por API directa contra App_dev',
  () => {
    let admin: TestClient // cliente con la clave de servicio, solo para preparar/verificar datos
    let administradora: TestClient // cliente logueado como andrea.rios

    beforeAll(async () => {
      admin = createAdminClient()
      const login = await loginAs(SEED_ACCOUNTS.admin)
      administradora = login.client
    })

    describe('lo que NO puede hacer aunque tenga las 7 capacidades (son "solo owner")', () => {
      it('CB-17: no puede llamar set_admin_capability (06_API.md: "set_admin_capability | RPC | O")', async () => {
        const targetId = await resolveUserId(admin, SEED_ACCOUNTS.employees[0])
        const { error } = await administradora.rpc('set_admin_capability', {
          p_profile_id: targetId,
          p_capability: 'manage_users',
          p_enabled: true,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede otorgar el rol owner con set_user_roles (06_API.md: "A + manage_users solo si el conjunto resultante no incluye owner ni admin")', async () => {
        const targetId = await resolveUserId(admin, SEED_ACCOUNTS.employees[0])
        const { error } = await administradora.rpc('set_user_roles', {
          p_profile_id: targetId,
          p_roles: ['owner'],
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no lee eventos de seguridad (04 sección 7.2: "security_events | O.")', async () => {
        const { data, error } = await administradora
          .from('security_events')
          .select('*')
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it('no puede crear un feriado (04 sección 7.2: "holidays | Todos autenticados. | O.")', async () => {
        const { error } = await administradora.from('holidays').insert({
          holiday_date: '2099-01-01',
          name: 'e2e-perm no debería crearse',
        })
        expect(error?.code).toBe('42501')
      })

      it('no puede crear un criterio de calificación (04 sección 7.2: "rating_criteria | ... | O.")', async () => {
        const { error } = await administradora.from('rating_criteria').insert({
          title: 'e2e-perm no debería crearse',
          position: 999,
        })
        expect(error?.code).toBe('42501')
      })
    })

    describe('lo que SÍ puede hacer (contraprueba)', () => {
      it('lee todos los empleados del seed, no solo los propios', async () => {
        const { count, error } = await administradora
          .from('employees')
          .select('profile_id', { count: 'exact', head: true })
        const esperado = await admin
          .from('employees')
          .select('profile_id', { count: 'exact', head: true })
        expect(error).toBeNull()
        expect(count).toBe(esperado.count)
        expect(count ?? 0).toBeGreaterThan(0)
      })

      it('lee todos los clientes del seed', async () => {
        const { count, error } = await administradora
          .from('clients')
          .select('id', { count: 'exact', head: true })
        const esperado = await admin
          .from('clients')
          .select('id', { count: 'exact', head: true })
        expect(error).toBeNull()
        expect(count).toBe(esperado.count)
      })

      it('lee todas las calificaciones, no solo las de una supervisión propia', async () => {
        const { count, error } = await administradora
          .from('ratings')
          .select('id', { count: 'exact', head: true })
        const esperado = await admin
          .from('ratings')
          .select('id', { count: 'exact', head: true })
        expect(error).toBeNull()
        expect(count).toBe(esperado.count)
      })

      it('lee company_settings completo (todas las columnas, a diferencia de anon)', async () => {
        const { data, error } = await administradora
          .from('company_settings')
          .select('*')
          .eq('id', 1)
        expect(error).toBeNull()
        expect(data?.[0]).toHaveProperty('location_consent_text')
      })

      it('con manage_users, llama set_user_roles reemplazando el rol de un empleado por el mismo conjunto (sin efecto de negocio, deja evento de auditoría real)', async () => {
        const targetId = await resolveUserId(admin, SEED_ACCOUNTS.employees[7]) // diego.fabbri
        const before = await admin
          .from('user_roles')
          .select('role')
          .eq('profile_id', targetId)
        const beforeRows = (before.data ?? []) as {
          role: 'owner' | 'admin' | 'supervisor' | 'employee'
        }[]
        const rolesActuales = beforeRows.map((r) => r.role)

        const { data, error } = await administradora.rpc('set_user_roles', {
          p_profile_id: targetId,
          p_roles: rolesActuales,
        })
        expect(error).toBeNull()
        expect(data).toEqual(rolesActuales)
      })
    })
  },
)
