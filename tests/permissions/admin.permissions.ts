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
import {
  cleanupFixtureChecklistClient,
  createFixtureChecklistClient,
  createFixtureShiftTask,
  deleteFixtureShiftTask,
  type FixtureChecklistClient,
} from './helpers/checklist-fixtures.ts'

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
        // Fecha de HOY en Argentina (offset fijo -03:00, ADR-019), no en UTC: entre las 21:00 y
        // las 24:00 de Argentina `toISOString()` ya da el día siguiente, y un turno de mañana a
        // las 00:00 todavía no empezó.
        const today = new Date(Date.now() - 3 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
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

    // TASK-008/TEST-009 (P12.3, 08_Fases_y_Backlog.md F12): `checklist_templates`/
    // `checklist_template_items` (O, A + edit_checklists escriben), `clone_checklist_template`,
    // `update_task_status` (siempre para O/A, no depende de ninguna capacidad puntual) y
    // `reload_shift_tasks` (capacidad y turno editable). andrea.rios (única admin del seed) tiene
    // las 7 capacidades: el caso "A SIN edit_checklists" necesita un administrador descartable con
    // esa capacidad puntual deshabilitada -- mismo criterio que el bloque SHIFT_STARTED de arriba
    // (P11.4), ahora deshabilitando `edit_checklists` en vez de `manage_attendance`.
    describe('checklists y tareas (F12, TEST-009)', () => {
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
      let checklistClient: FixtureChecklistClient
      let clientTemplateId: string
      // Turno dedicado a `update_task_status`: nunca se le llama `reload_shift_tasks`, para que
      // la tarea de fixture no desaparezca antes de que los dos tests de abajo la usen (`copy_
      // checklist_to_shift`, invocado por esa RPC, reemplaza TODAS las tareas del turno).
      let taskShift: FixtureShift
      let taskId: string
      // Turno aparte, dedicado a `reload_shift_tasks` (sin ninguna tarea propia: alcanza con que
      // exista y esté `scheduled`/`completed` para probar la capacidad y el estado).
      let reloadableShift: FixtureShift
      let notEditableShift: FixtureShift

      beforeAll(async () => {
        const email = `e2e-perm-admin-sin-checklists-${Date.now()}@extendiendoservicios.com`
        const password = `${process.env.SEED_DEV_PASSWORD}Aa1`
        const { data: created, error: createError } =
          await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
              first_name: 'E2E',
              last_name: `Perm Admin Sin Checklists ${Date.now()}`,
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
              enabled: capability !== 'edit_checklists', // la única deshabilitada a propósito.
              updated_by: null,
            })),
          )
        if (capsError) {
          throw new Error(
            `No se pudieron cargar las capacidades: ${capsError.message}`,
          )
        }

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

        checklistClient = await createFixtureChecklistClient(admin)

        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        taskShift = await createFixtureShift(admin, tomorrow, '05:00', '06:00')
        taskId = await createFixtureShiftTask(
          admin,
          taskShift.shiftId,
          'update-status',
        )

        reloadableShift = await createFixtureShift(
          admin,
          tomorrow,
          '06:30',
          '07:30',
        )

        notEditableShift = await createFixtureShift(
          admin,
          tomorrow,
          '08:00',
          '09:00',
        )
        const { error: statusError } = await admin
          .from('shifts')
          .update({ status: 'completed' })
          .eq('id', notEditableShift.shiftId)
        if (statusError) {
          throw new Error(
            `No se pudo forzar el turno de fixture a completed: ${statusError.message}`,
          )
        }
      })

      afterAll(async () => {
        await limitedAdmin.auth.signOut()
        await deleteFixtureShiftTask(admin, taskId)
        await cleanupFixtureShift(admin, taskShift)
        await cleanupFixtureShift(admin, reloadableShift)
        await cleanupFixtureShift(admin, notEditableShift)
        await cleanupFixtureChecklistClient(admin, checklistClient)
        await admin.auth.admin.updateUserById(limitedAdminProfileId, {
          ban_duration: '876000h',
        })
        await admin
          .from('profiles')
          .update({ is_active: false, deleted_at: new Date().toISOString() })
          .eq('id', limitedAdminProfileId)
      })

      it('con edit_checklists, crea la plantilla del cliente por API directa (04 sección 7.2: "checklist_templates... O, A con edit_checklists")', async () => {
        const { data, error } = await administradora
          .from('checklist_templates')
          .insert({
            client_id: checklistClient.clientId,
            site_id: null,
            name: 'E2E-P123-PERM Plantilla del cliente',
          })
          .select('id, client_id')
          .single()
        expect(error).toBeNull()
        expect(data?.client_id).toBe(checklistClient.clientId)
        clientTemplateId = data!.id
      })

      it('con edit_checklists, agrega un ítem a esa plantilla', async () => {
        const { data, error } = await administradora
          .from('checklist_template_items')
          .insert({
            template_id: clientTemplateId,
            position: 0,
            title: 'E2E-P123-PERM ítem',
            is_required: true,
          })
          .select('id')
          .single()
        expect(error).toBeNull()
        expect(data?.id).toBeDefined()
      })

      it('con edit_checklists, clona la plantilla del cliente para una sede (clone_checklist_template, P-058)', async () => {
        const { data, error } = await administradora.rpc(
          'clone_checklist_template',
          {
            p_client_id: checklistClient.clientId,
            p_site_id: checklistClient.siteForCloneId,
          },
        )
        expect(error).toBeNull()
        expect(data?.site_id).toBe(checklistClient.siteForCloneId)
      })

      it('update_task_status: el administrador cambia el estado de cualquier tarea, sin depender de ninguna capacidad', async () => {
        const { data, error } = await administradora.rpc('update_task_status', {
          p_task_id: taskId,
          p_status: 'in_progress',
        })
        expect(error).toBeNull()
        expect(data?.status).toBe('in_progress')
      })

      it('reload_shift_tasks: con edit_checklists y turno scheduled, la RPC no falla', async () => {
        const { error } = await administradora.rpc('reload_shift_tasks', {
          p_shift_id: reloadableShift.shiftId,
        })
        expect(error).toBeNull()
      })

      it('reload_shift_tasks: turno no editable (completed) responde SHIFT_NOT_EDITABLE', async () => {
        const { error } = await administradora.rpc('reload_shift_tasks', {
          p_shift_id: notEditableShift.shiftId,
        })
        expect(error?.hint).toBe('SHIFT_NOT_EDITABLE')
      })

      it('sin edit_checklists, NO puede insertar una plantilla (RLS)', async () => {
        const { error } = await limitedAdmin
          .from('checklist_templates')
          .insert({
            client_id: checklistClient.clientId,
            site_id: checklistClient.siteWithoutTemplateId,
            name: 'e2e-perm no debería crearse',
          })
        expect(error?.code).toBe('42501')
      })

      it('sin edit_checklists, NO puede agregar un ítem a una plantilla existente (RLS)', async () => {
        const { error } = await limitedAdmin
          .from('checklist_template_items')
          .insert({
            template_id: clientTemplateId,
            position: 1,
            title: 'e2e-perm no debería crearse',
          })
        expect(error?.code).toBe('42501')
      })

      it('sin edit_checklists, NO puede llamar clone_checklist_template (FORBIDDEN)', async () => {
        const { error } = await limitedAdmin.rpc('clone_checklist_template', {
          p_client_id: checklistClient.clientId,
          p_site_id: checklistClient.siteWithoutTemplateId,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('sin edit_checklists, NO puede llamar reload_shift_tasks (FORBIDDEN)', async () => {
        const { error } = await limitedAdmin.rpc('reload_shift_tasks', {
          p_shift_id: reloadableShift.shiftId,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('sin edit_checklists, SÍ puede llamar update_task_status (no depende de esa capacidad)', async () => {
        const { data, error } = await limitedAdmin.rpc('update_task_status', {
          p_task_id: taskId,
          p_status: 'done',
        })
        expect(error).toBeNull()
        expect(data?.status).toBe('done')
      })
    })

    // MOB-EMP-017/TEST-010 (P13.4, 08_Fases_y_Backlog.md F13, `06` sección 10): `record_check_in`
    // y `record_check_out` son "E (propia)" a secas -- ni siquiera la administradora con las 7
    // capacidades puede registrar el inicio o el fin de otra persona. `set_assignment_notes` sí
    // es "E (propia, turno no completado), O, A": la administradora puede cargar la observación
    // de una asignación ajena. El pgTAP de `0026_rpc_attendance.sql` (P13.1) ya prueba esto mismo
    // a nivel de función; acá interesa la vía real de PostgREST con JWT (encargo P13.4).
    describe('asistencia (F13): no registra inicio/fin ajenos, sí puede escribir la observación', () => {
      let fixture: FixtureShift
      let fixtureAssignmentId: string
      let empleadoAsistenciaId: string

      beforeAll(async () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        fixture = await createFixtureShift(admin, tomorrow, '17:00', '18:00')
        empleadoAsistenciaId = await resolveUserId(
          admin,
          SEED_ACCOUNTS.employees[2],
        )
        fixtureAssignmentId = await createFixtureAssignment(
          administradora,
          fixture.shiftId,
          empleadoAsistenciaId,
        )
      })

      afterAll(async () => {
        await removeFixtureAssignment(administradora, fixtureAssignmentId)
        await cleanupFixtureShift(admin, fixture)
      })

      it('no puede llamar record_check_in sobre una asignación ajena', async () => {
        const { error } = await administradora.rpc('record_check_in', {
          p_assignment_id: fixtureAssignmentId,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede llamar record_check_out sobre una asignación ajena', async () => {
        const { error } = await administradora.rpc('record_check_out', {
          p_assignment_id: fixtureAssignmentId,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('sí puede escribir la observación de esa asignación ajena (set_assignment_notes)', async () => {
        const { data, error } = await administradora.rpc(
          'set_assignment_notes',
          {
            p_assignment_id: fixtureAssignmentId,
            p_notes: 'E2E-P114-PERM: observación cargada por administración',
          },
        )
        expect(error).toBeNull()
        expect(data?.notes).toBe(
          'E2E-P114-PERM: observación cargada por administración',
        )
      })
    })

    // ABS-002/ATT-007 (P14.1, 08_Fases_y_Backlog.md F14, `06` sección 10 y 11): las cuatro RPC
    // nuevas son "O; A + manage_attendance" a secas (sin variante "propia" para admin, a
    // diferencia de notify_delay/notify_absence del lado del empleado, cubiertas en
    // employee.permissions.ts). Mismo criterio que el bloque SHIFT_STARTED de arriba: un
    // administrador descartable SIN manage_attendance para el negativo, y `administradora` (las 7
    // capacidades) para el positivo "en nombre".
    describe('avisos y asistencia administrativa (F14): FORBIDDEN sin manage_attendance, en nombre con ella', () => {
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
      let empleadoAvisosId: string
      // admin_record_attendance/close_assignment validan que p_at (por defecto now()) esté entre
      // las 0:00 del día del turno y "ahora" (AT_OUT_OF_RANGE, P14.0): con un turno de MAÑANA esa
      // franja todavía no empieza (las 0:00 de mañana son posteriores a "ahora"), así que necesitan
      // una fixture de turno de HOY aparte -- notify_delay/notify_absence, en cambio, sí necesitan
      // un turno que no haya empezado, por eso siguen sobre la fixture de mañana de arriba.
      let fixtureToday: FixtureShift
      let fixtureTodayAssignmentId: string
      let empleadoAsistenciaId: string

      beforeAll(async () => {
        const email = `e2e-perm-admin-sin-asistencia-f14-${Date.now()}@extendiendoservicios.com`
        const password = `${process.env.SEED_DEV_PASSWORD}Aa1`
        const { data: created, error: createError } =
          await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
              first_name: 'E2E',
              last_name: `Perm Admin Sin Asistencia F14 ${Date.now()}`,
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
              enabled: capability !== 'manage_attendance',
              updated_by: null,
            })),
          )
        if (capsError) {
          throw new Error(
            `No se pudieron cargar las capacidades: ${capsError.message}`,
          )
        }

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

        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        fixture = await createFixtureShift(admin, tomorrow, '19:00', '20:00')
        empleadoAvisosId = await resolveUserId(
          admin,
          SEED_ACCOUNTS.employees[3],
        )
        // La fixture se arma con `administradora` (sí tiene manage_attendance): `service_role` no
        // puede insertar en `assignments` directo (ver el comentario de `createFixtureAssignment`).
        fixtureAssignmentId = await createFixtureAssignment(
          administradora,
          fixture.shiftId,
          empleadoAvisosId,
        )

        // Turno de HOY (Argentina, mismo truco de "-3 horas" que el bloque SHIFT_STARTED de
        // arriba) para admin_record_attendance/close_assignment -- ver el comentario de
        // `fixtureToday` más arriba.
        const today = new Date(Date.now() - 3 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        fixtureToday = await createFixtureShift(admin, today, '06:00', '07:00')
        empleadoAsistenciaId = await resolveUserId(
          admin,
          SEED_ACCOUNTS.employees[4],
        )
        fixtureTodayAssignmentId = await createFixtureAssignment(
          administradora,
          fixtureToday.shiftId,
          empleadoAsistenciaId,
        )
      })

      afterAll(async () => {
        // La asignación de `fixtureToday` termina `finished` (el test de `close_assignment` de
        // más abajo la cierra): `remove_assignment` la rechazaría con `ASSIGNMENT_STARTED`
        // (`status in ('present','finished')`, `0024_rpc_assignments.sql`) -- se libera con un
        // `update` directo, mismo criterio que la limpieza de `update_task_status` en
        // `employee.permissions.ts`.
        await admin
          .from('assignments')
          .update({
            removed_at: new Date().toISOString(),
            removed_by: limitedAdminProfileId,
            removed_reason:
              'E2E-P114-PERM: limpieza de la asignación de fixture F14',
          })
          .eq('id', fixtureTodayAssignmentId)
        await cleanupFixtureShift(admin, fixtureToday)
        await removeFixtureAssignment(administradora, fixtureAssignmentId)
        await limitedAdmin.auth.signOut()
        await cleanupFixtureShift(admin, fixture)
        await admin.auth.admin.updateUserById(limitedAdminProfileId, {
          ban_duration: '876000h',
        })
        await admin
          .from('profiles')
          .update({ is_active: false, deleted_at: new Date().toISOString() })
          .eq('id', limitedAdminProfileId)
      })

      it('FORBIDDEN: notify_delay sin manage_attendance', async () => {
        const { error } = await limitedAdmin.rpc('notify_delay', {
          p_assignment_id: fixtureAssignmentId,
          p_minutes: 15,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('FORBIDDEN: notify_absence sin manage_attendance', async () => {
        const { error } = await limitedAdmin.rpc('notify_absence', {
          p_assignment_id: fixtureAssignmentId,
          p_reason_code: 'illness',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('FORBIDDEN: admin_record_attendance sin manage_attendance', async () => {
        const { error } = await limitedAdmin.rpc('admin_record_attendance', {
          p_assignment_id: fixtureTodayAssignmentId,
          p_kind: 'check_in',
          p_reason: 'e2e-perm no debería aplicarse',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('FORBIDDEN: close_assignment sin manage_attendance', async () => {
        const { error } = await limitedAdmin.rpc('close_assignment', {
          p_assignment_id: fixtureTodayAssignmentId,
          p_reason: 'e2e-perm no debería aplicarse',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('con manage_attendance, avisa demora en nombre del empleado (reported_by la administradora)', async () => {
        const { data, error } = await administradora.rpc('notify_delay', {
          p_assignment_id: fixtureAssignmentId,
          p_minutes: 20,
        })
        expect(error).toBeNull()
        expect(data?.minutes_late).toBe(20)
      })

      it('con manage_attendance, registra el inicio en nombre del empleado (admin_record_attendance)', async () => {
        const { data, error } = await administradora.rpc(
          'admin_record_attendance',
          {
            p_assignment_id: fixtureTodayAssignmentId,
            p_kind: 'check_in',
            p_reason: 'E2E-P114-PERM: inicio cargado por administración',
          },
        )
        expect(error).toBeNull()
        expect(data?.kind).toBe('check_in')
      })

      it('con manage_attendance, cierra la asignación en nombre del empleado (close_assignment)', async () => {
        const { data, error } = await administradora.rpc('close_assignment', {
          p_assignment_id: fixtureTodayAssignmentId,
          p_reason: 'E2E-P114-PERM: cierre manual cargado por administración',
        })
        expect(error).toBeNull()
        expect(data?.kind).toBe('check_out')
      })
    })
  },
)
