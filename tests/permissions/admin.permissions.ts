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
//
// Los ids de las cuentas objetivo se resuelven UNA sola vez en `beforeAll` (no dentro de cada
// `it`): con los cuatro archivos de esta carpeta corriendo en paralelo (Vitest, un worker por
// archivo), reconsultar `auth.admin.listUsers()` en cada caso multiplica las llamadas
// concurrentes a la Admin API sin necesidad -- se vio un falso positivo intermitente en el
// reporte de esta tarea con ese patrón (ver el reporte para el detalle de la investigación).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminClient,
  createAnonClient,
  loginAs,
  type TestClient,
} from './helpers/clients.ts'
import { resolveUserId } from './helpers/admin-lookups.ts'
import { missingEnvWarning, readPermissionsTestEnv } from './helpers/env.ts'
import { SEED_ACCOUNTS } from './fixtures/seed-accounts.ts'
import {
  cleanupFixtureShift,
  createFixtureAssignment,
  createFixtureShift,
  removeFixtureAssignment,
  type FixtureShift,
} from './helpers/assignment-fixtures.ts'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const env = readPermissionsTestEnv()
if (!env) console.warn(missingEnvWarning('admin.permissions.ts'))

describe.skipIf(!env)(
  'rol admin (no owner) — permisos por API directa contra App_dev',
  () => {
    let admin: TestClient // cliente con la clave de servicio, solo para preparar/verificar datos
    let administradora: TestClient // cliente logueado como andrea.rios
    let empleadoObjetivoId: string // maria.gomez, target de los RPC que deben fallar
    let otroEmpleadoObjetivoId: string // diego.fabbri, target del RPC que sí debe funcionar

    beforeAll(async () => {
      admin = createAdminClient()
      const login = await loginAs(SEED_ACCOUNTS.admin)
      administradora = login.client
      empleadoObjetivoId = await resolveUserId(
        admin,
        SEED_ACCOUNTS.employees[0],
      )
      otroEmpleadoObjetivoId = await resolveUserId(
        admin,
        SEED_ACCOUNTS.employees[7],
      )

      // Defensa contra el falso positivo del reporte de esta tarea: si `resolveUserId` alguna vez
      // no devuelve un uuid real, mejor un mensaje claro acá que un "no tiene permiso" confuso más
      // abajo.
      expect(empleadoObjetivoId).toMatch(UUID_RE)
      expect(otroEmpleadoObjetivoId).toMatch(UUID_RE)
      expect(otroEmpleadoObjetivoId).not.toBe(empleadoObjetivoId)
    })

    describe('lo que NO puede hacer aunque tenga las 7 capacidades (son "solo owner")', () => {
      it('CB-17: no puede llamar set_admin_capability (06_API.md: "set_admin_capability | RPC | O")', async () => {
        const { error } = await administradora.rpc('set_admin_capability', {
          p_profile_id: empleadoObjetivoId,
          p_capability: 'manage_users',
          p_enabled: true,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede otorgar el rol owner con set_user_roles (06_API.md: "A + manage_users solo si el conjunto resultante no incluye owner ni admin")', async () => {
        const { error } = await administradora.rpc('set_user_roles', {
          p_profile_id: empleadoObjetivoId,
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
        const before = await admin
          .from('user_roles')
          .select('role')
          .eq('profile_id', otroEmpleadoObjetivoId)
        const beforeRows = (before.data ?? []) as {
          role: 'owner' | 'admin' | 'supervisor' | 'employee'
        }[]
        const rolesActuales = beforeRows.map((r) => r.role)
        expect(rolesActuales.length).toBeGreaterThan(0)

        const { data, error } = await administradora.rpc('set_user_roles', {
          p_profile_id: otroEmpleadoObjetivoId,
          p_roles: rolesActuales,
        })
        expect(error).toBeNull()
        expect(data).toEqual(rolesActuales)
      })
    })

    // ASSIGN-015/TEST-008 (P11.4, 08_Fases_y_Backlog.md F11): "administrador sin
    // manage_attendance sobre turno ya empezado → SHIFT_STARTED" (`06` sección 8:
    // "assign_employee/remove_assignment | O, A (después del inicio del turno: + manage_attendance)").
    // andrea.rios (la única admin del seed) tiene las 7 capacidades, así que este caso necesita
    // un administrador descartable SIN esa capacidad -- creado directo con la clave de servicio
    // (sin pasar por la Edge Function `admin-users`, que esta carpeta no invoca: corre con
    // Vitest, no con un navegador). El turno de fixture tiene que estar ya empezado de verdad
    // (`SHIFT_STARTED` depende del reloj real, no se puede probar en un mes lejano): fecha de
    // hoy, hora ya pasada.
    describe('SHIFT_STARTED: administrador sin manage_attendance, turno ya empezado', () => {
      const ALL_CAPABILITIES = [
        'manage_users',
        'cancel_shifts',
        'edit_ratings',
        'edit_checklists',
        'manage_attendance',
        'generate_shifts',
        'manage_supervisions',
      ] as const

      let limitedAdminProfileId: string
      let limitedAdmin: TestClient
      let fixture: FixtureShift
      let fixtureAssignmentId: string
      let otroEmpleadoParaAsignarId: string

      beforeAll(async () => {
        const email = `e2e-perm-admin-sin-asistencia-${Date.now()}@extendiendoservicios.com`
        const password = `${process.env.SEED_DEV_PASSWORD}Aa1`
        const { data: created, error: createError } =
          await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
              first_name: 'E2E',
              last_name: `Perm Admin Sin Asistencia ${Date.now()}`,
            },
          })
        if (createError || !created.user) {
          throw new Error(
            `No se pudo crear el administrador descartable: ${createError?.message}`,
          )
        }
        limitedAdminProfileId = created.user.id

        const { error: roleError } = await admin.from('user_roles').insert({
          profile_id: limitedAdminProfileId,
          role: 'admin',
          granted_by: null,
        })
        if (roleError) {
          throw new Error(
            `No se pudo asignar el rol admin: ${roleError.message}`,
          )
        }

        const { error: capsError } = await admin
          .from('admin_capabilities')
          .insert(
            ALL_CAPABILITIES.map((capability) => ({
              profile_id: limitedAdminProfileId,
              capability,
              enabled: capability !== 'manage_attendance', // la única deshabilitada a propósito.
              updated_by: null,
            })),
          )
        if (capsError) {
          throw new Error(
            `No se pudieron cargar las capacidades: ${capsError.message}`,
          )
        }

        // `loginAs` (helpers/clients.ts) siempre usa la contraseña COMPARTIDA del seed: no
        // sirve para este administrador descartable, que tiene una contraseña propia distinta
        // (`SEED_DEV_PASSWORD` + sufijo, mismo criterio que `owner-creates-admin-and-capabilities.spec.ts`
        // de `tests/e2e-users`). Login manual con el cliente anónimo.
        const anonClient = createAnonClient()
        const { error: loginError } = await anonClient.auth.signInWithPassword({
          email,
          password,
        })
        if (loginError) {
          throw new Error(
            `No se pudo iniciar sesión con el administrador descartable: ${loginError.message}`,
          )
        }
        limitedAdmin = anonClient

        // Turno de HOY, de 00:00 a 00:01 (hora de Argentina, `app.local_ts`, `0007`): a
        // cualquier hora del día en la que corra esta suite, `starts_at` (columna generada) ya
        // quedó atrás -- `shiftStarted` en el servidor se calcula contra el reloj real, no hay
        // forma de fijar una hora concreta "ya pasada" sin depender de a qué hora se ejecuta el
        // test. Un minuto de franja (no todo el día): minimiza el riesgo de solaparse con un
        // turno real de la persona elegida más abajo.
        const today = new Date().toISOString().slice(0, 10)
        fixture = await createFixtureShift(admin, today, '00:00', '00:01')

        otroEmpleadoParaAsignarId = await resolveUserId(
          admin,
          SEED_ACCOUNTS.employees[1],
        )
        // La fixture se arma con `administradora` (rol admin, con las 7 capacidades incluida
        // `manage_attendance`, ya logueada más arriba en el describe padre): es quien puede
        // llamar `assign_employee` sobre un turno ya empezado sin que le aplique `SHIFT_STARTED`
        // (ver el comentario de `createFixtureAssignment`: `service_role` no puede insertar en
        // `assignments` directo). Empleado dedicado (`employees[9]`, patricia.nunez), NO
        // `employees[0]` (maria.gomez): esa persona la usa `employee.permissions.ts` para un
        // conteo EXACTO de sus propias asignaciones vigentes -- con los archivos de esta carpeta
        // corriendo en paralelo, una asignación de fixture de más sobre maria.gomez hacía fallar
        // ese test ajeno de forma intermitente (mismo hallazgo que documenta
        // `supervisor.permissions.ts`, ver el reporte del encargo).
        const employeeToAssignId = await resolveUserId(
          admin,
          SEED_ACCOUNTS.employees[9],
        )
        fixtureAssignmentId = await createFixtureAssignment(
          administradora,
          fixture.shiftId,
          employeeToAssignId,
        )
      })

      afterAll(async () => {
        // Se remueve con `administradora` (sí tiene manage_attendance): `limitedAdmin` no pudo
        // hacerlo en los dos tests de arriba (SHIFT_STARTED, a propósito), así que la asignación
        // sigue vigente y su franja seguiría bloqueando la próxima corrida (mismo hallazgo que
        // documenta `removeFixtureAssignment`).
        await removeFixtureAssignment(administradora, fixtureAssignmentId)
        await limitedAdmin.auth.signOut()
        await cleanupFixtureShift(admin, fixture)
        // Deja al administrador descartable desactivado, sin borrarlo (mismo criterio que
        // `tests/e2e-users/helpers/adminUsersClient.ts`: `banDirectly`).
        await admin.auth.admin.updateUserById(limitedAdminProfileId, {
          ban_duration: '876000h',
        })
        await admin
          .from('profiles')
          .update({ is_active: false, deleted_at: new Date().toISOString() })
          .eq('id', limitedAdminProfileId)
      })

      it('assign_employee sobre el turno ya empezado responde SHIFT_STARTED (no FORBIDDEN)', async () => {
        const { error } = await limitedAdmin.rpc('assign_employee', {
          p_shift_id: fixture.shiftId,
          p_employee_id: otroEmpleadoParaAsignarId,
        })
        expect(error?.hint).toBe('SHIFT_STARTED')
      })

      it('remove_assignment sobre el turno ya empezado responde SHIFT_STARTED', async () => {
        const { error } = await limitedAdmin.rpc('remove_assignment', {
          p_assignment_id: fixtureAssignmentId,
          p_reason: 'e2e-perm no debería aplicarse sin manage_attendance',
        })
        expect(error?.hint).toBe('SHIFT_STARTED')
      })
    })
  },
)
