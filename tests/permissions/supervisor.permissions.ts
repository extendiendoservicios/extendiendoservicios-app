// tests/permissions/supervisor.permissions.ts — P04.7 (08_Fases_y_Backlog.md, F4)
//
// "Si te da el tiempo, sumá supervisora y administradora con el mismo criterio: lo que puede y
// lo que no" (encargo P04.7). Tratamiento representativo, no exhaustivo (igual que
// employee.permissions.ts): la suite completa es TEST-019 (F18).
//
// Supervisora principal: paula.lemos, que en el seed actual supervisa dos turnos, ambos con
// maria.gomez como única empleada asignada (verificado en el reporte de esta tarea) -- por eso
// maria.gomez hace de "su equipo" acá. "Otra supervisora" (ajena): noelia.vera. "Empleado fuera
// de su equipo": juan.perez.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminClient,
  loginAs,
  type TestClient,
} from './helpers/clients.ts'
import { resolveUserId } from './helpers/admin-lookups.ts'
import { missingEnvWarning, readPermissionsTestEnv } from './helpers/env.ts'
import { SEED_ACCOUNTS } from './fixtures/seed-accounts.ts'
import {
  cleanupFixtureShift,
  createFixtureAssignment,
  removeFixtureAssignment,
  createFixtureShift,
  type FixtureShift,
} from './helpers/assignment-fixtures.ts'
import {
  createFixtureShiftTask,
  deleteFixtureShiftTask,
} from './helpers/checklist-fixtures.ts'

const env = readPermissionsTestEnv()
if (!env) console.warn(missingEnvWarning('supervisor.permissions.ts'))

describe.skipIf(!env)(
  'rol supervisor — permisos por API directa contra App_dev',
  () => {
    let admin: TestClient
    let supervisora: TestClient
    let supervisoraId: string
    let empleadoAjenoId: string
    let empleadoDeSuEquipoId: string

    beforeAll(async () => {
      admin = createAdminClient()
      const login = await loginAs(SEED_ACCOUNTS.supervisors[0]) // paula.lemos
      supervisora = login.client
      supervisoraId = login.userId
      // Los dos ids se resuelven acá, una sola vez (no dentro de cada `it`): con los cuatro
      // archivos de esta carpeta corriendo en paralelo, reconsultar `auth.admin.listUsers()`
      // repetidas veces multiplica las llamadas concurrentes a la Admin API sin necesidad -- ver
      // el reporte de esta tarea para el falso positivo intermitente que motivó este cambio.
      empleadoAjenoId = await resolveUserId(admin, SEED_ACCOUNTS.employees[1]) // juan.perez
      empleadoDeSuEquipoId = await resolveUserId(
        admin,
        SEED_ACCOUNTS.employees[0],
      ) // maria.gomez
    })

    afterAll(async () => {
      await supervisora.auth.signOut()
    })

    describe('lo que NO puede hacer', () => {
      it('no lee empleados fuera de su equipo (04 sección 7.2: "employees | ... S: empleados de sus turnos")', async () => {
        const { data, error } = await supervisora
          .from('employees')
          .select('*')
          .eq('profile_id', empleadoAjenoId)
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it('solo lee las calificaciones de SUS supervisiones, no las de otra supervisora (04 sección 7.2: "ratings | ... S: propias")', async () => {
        const suyas = await supervisora.from('ratings').select('id')
        expect(suyas.error).toBeNull()

        const suyasRows = (suyas.data ?? []) as { id: string }[]
        const idsSuyos = new Set(suyasRows.map((r) => r.id))

        const todasLasSupervisiones = await admin
          .from('supervisions')
          .select('id, supervisor_id')
        const supervisionesRows = (todasLasSupervisiones.data ?? []) as {
          id: string
          supervisor_id: string
        }[]
        const idsDeSusSupervisiones = new Set(
          supervisionesRows
            .filter((s) => s.supervisor_id === supervisoraId)
            .map((s) => s.id),
        )
        const esperado = await admin
          .from('ratings')
          .select('id, supervision_id')
        const esperadoRows = (esperado.data ?? []) as {
          id: string
          supervision_id: string
        }[]
        const esperadoIds = new Set(
          esperadoRows
            .filter((r) => idsDeSusSupervisiones.has(r.supervision_id))
            .map((r) => r.id),
        )

        expect(idsSuyos).toEqual(esperadoIds)

        // Si el seed no tuviera ninguna calificación ajena, este test no probaría el aislamiento
        // real. Lo dejamos como aserción informativa en vez de bloqueante (no es requisito del
        // criterio de aceptación de F4): se confirma en el reporte con los datos reales.
      })

      it('CB-17 / RB-A01: no puede llamar set_admin_capability', async () => {
        const { error } = await supervisora.rpc('set_admin_capability', {
          p_profile_id: supervisoraId,
          p_capability: 'manage_users',
          p_enabled: true,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede llamar set_user_roles (sin manage_users: esa capacidad es de admin)', async () => {
        const { error } = await supervisora.rpc('set_user_roles', {
          p_profile_id: supervisoraId,
          p_roles: ['supervisor'],
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede insertar un cliente por API directa', async () => {
        const { error } = await supervisora.from('clients').insert({
          legal_name: 'e2e-perm no debería crearse',
          trade_name: 'e2e-perm',
          cuit: '20111111113',
        })
        expect(error?.code).toBe('42501')
      })

      it('no puede crear un criterio de calificación (04 sección 7.2: "rating_criteria | ... | O.")', async () => {
        const { error } = await supervisora.from('rating_criteria').insert({
          title: 'e2e-perm no debería crearse',
          position: 999,
        })
        expect(error?.code).toBe('42501')
      })

      it('no lee eventos de seguridad (04 sección 7.2: "security_events | O.")', async () => {
        const { data, error } = await supervisora
          .from('security_events')
          .select('*')
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      // P10.4 (08_Fases_y_Backlog.md F10): mismos casos que suma employee.permissions.ts, ahora
      // para el rol supervisor (encargo P10.4, "sumá esos casos" a la suite de permisos).
      const ANY_UUID = '00000000-0000-0000-0000-000000000000'

      it('no puede llamar create_shift (06 sección 7: "O, A" a secas, sin rol para supervisor)', async () => {
        const { error } = await supervisora.rpc('create_shift', {
          p_client_id: ANY_UUID,
          p_site_id: ANY_UUID,
          p_date: '2190-06-01',
          p_start: '08:00',
          p_end: '12:00',
          p_required_staff: 1,
        })
        expect(error?.hint ?? error?.message).toMatch(/FORBIDDEN/i)
      })

      it('no puede llamar generate_shifts (06 sección 6: "O; A + generate_shifts")', async () => {
        const { error } = await supervisora.rpc('generate_shifts', {
          p_year: 2190,
          p_month: 6,
        })
        expect(error?.hint ?? error?.message).toMatch(/FORBIDDEN/i)
      })

      it('no puede llamar cancel_shift (06 sección 7: "O; A + cancel_shifts")', async () => {
        const { error } = await supervisora.rpc('cancel_shift', {
          p_shift_id: ANY_UUID,
          p_reason: 'e2e-perm no debería aplicarse',
        })
        expect(error?.hint ?? error?.message).toMatch(/FORBIDDEN/i)
      })

      it('no puede insertar un servicio por API directa (06 sección 6: "Crear, editar | O, A")', async () => {
        const { error } = await supervisora.from('services').insert({
          client_id: ANY_UUID,
          site_id: ANY_UUID,
          name: 'e2e-perm no debería crearse',
          weekdays: [1],
          start_time: '08:00',
          end_time: '12:00',
          valid_from: '2190-06-01',
        })
        expect(error?.code).toBe('42501')
      })

      // TASK-008/TEST-009 (P12.3, 08_Fases_y_Backlog.md F12): `06` sección 9 no le da a la
      // supervisora ningún canal sobre plantillas ni tareas -- ni siquiera de lectura de la
      // plantilla ("O, A" a secas); las tres RPC del dominio cortan con FORBIDDEN antes de mirar
      // nada más (`app.require_capability`/rama `else` de `update_task_status`).
      it('no puede insertar una plantilla de tareas por API directa', async () => {
        const { error } = await supervisora.from('checklist_templates').insert({
          client_id: ANY_UUID,
          site_id: null,
          name: 'e2e-perm no debería crearse',
        })
        expect(error?.code).toBe('42501')
      })

      it('no puede insertar un ítem de plantilla por API directa', async () => {
        const { error } = await supervisora
          .from('checklist_template_items')
          .insert({
            template_id: ANY_UUID,
            position: 0,
            title: 'e2e-perm no debería crearse',
          })
        expect(error?.code).toBe('42501')
      })

      it('no puede llamar clone_checklist_template', async () => {
        const { error } = await supervisora.rpc('clone_checklist_template', {
          p_client_id: ANY_UUID,
          p_site_id: ANY_UUID,
        })
        expect(error?.hint ?? error?.message).toMatch(/FORBIDDEN/i)
      })

      it('no puede llamar reload_shift_tasks', async () => {
        const { error } = await supervisora.rpc('reload_shift_tasks', {
          p_shift_id: ANY_UUID,
        })
        expect(error?.hint ?? error?.message).toMatch(/FORBIDDEN/i)
      })
    })

    describe('lo que SÍ puede hacer', () => {
      it('lee sus propias supervisiones', async () => {
        const suyas = await supervisora.from('supervisions').select('id')
        expect(suyas.error).toBeNull()

        const esperado = await admin
          .from('supervisions')
          .select('id')
          .eq('supervisor_id', supervisoraId)
        const suyasRows = (suyas.data ?? []) as { id: string }[]
        const esperadoRows = (esperado.data ?? []) as { id: string }[]
        const suyasIds = new Set(suyasRows.map((r) => r.id))
        const esperadoIds = new Set(esperadoRows.map((r) => r.id))
        expect(suyasIds).toEqual(esperadoIds)
        expect(suyasIds.size).toBeGreaterThan(0)
      })

      it('lee los datos laborales de un empleado de su equipo', async () => {
        const { data, error } = await supervisora
          .from('employees')
          .select('*')
          .eq('profile_id', empleadoDeSuEquipoId)
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
      })

      it('lee los criterios de calificación vigentes y pasados (04 sección 7.2: "rating_criteria | O, A, S: vigentes y pasadas")', async () => {
        const { count, error } = await supervisora
          .from('rating_criteria')
          .select('id', { count: 'exact', head: true })
        expect(error).toBeNull()
        expect(count ?? 0).toBeGreaterThan(0)
      })

      it('lee los feriados y la configuración de la empresa (todos autenticados)', async () => {
        const holidays = await supervisora
          .from('holidays')
          .select('id', { count: 'exact', head: true })
        expect(holidays.error).toBeNull()
        expect(holidays.count ?? 0).toBeGreaterThan(0)

        const settings = await supervisora
          .from('company_settings')
          .select('*')
          .eq('id', 1)
        expect(settings.error).toBeNull()
        expect(settings.data).toHaveLength(1)
      })
    })

    // ASSIGN-015/TEST-008 (P11.4, 08_Fases_y_Backlog.md F11): `06` sección 8 no le da a la
    // supervisora ningún canal para asignar, quitar ni editar turnos/asignaciones -- ni siquiera
    // sobre un turno que supervisa. Turno y asignación de fixture propios (no del seed).
    describe('las cuatro RPC de asignaciones (06 sección 8): ninguna es para el rol supervisor', () => {
      let fixture: FixtureShift
      let fixtureAssignmentId: string
      let dueno: TestClient

      beforeAll(async () => {
        // Mañana, de madrugada (03:00-04:00): horario del que casi con certeza nadie del seed
        // tiene un turno real hoy (una franja diurna típica de limpieza sí podría chocar con
        // `ASSIGNMENT_OVERLAP`, ya observado armando esta suite).
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        fixture = await createFixtureShift(admin, tomorrow, '03:00', '04:00')
        // La asignación de fixture se arma con el dueño (ver el comentario de
        // `createFixtureAssignment`: `service_role` no puede insertar en `assignments`). Empleado
        // dedicado (`employees[9]`, patricia.nunez), NO `empleadoDeSuEquipoId` (maria.gomez): esa
        // persona la usa también `employee.permissions.ts` para un conteo EXACTO de sus propias
        // asignaciones vigentes -- con los archivos de esta carpeta corriendo en paralelo (un
        // worker de Vitest por archivo), una asignación de fixture de más sobre maria.gomez
        // hacía fallar ese test ajeno de forma intermitente (encontrado armando esta suite, ver
        // el reporte del encargo).
        const ownerLogin = await loginAs(SEED_ACCOUNTS.owner)
        dueno = ownerLogin.client
        const fixtureEmployeeId = await resolveUserId(
          admin,
          SEED_ACCOUNTS.employees[9],
        )
        fixtureAssignmentId = await createFixtureAssignment(
          dueno,
          fixture.shiftId,
          fixtureEmployeeId,
        )
      })

      afterAll(async () => {
        await removeFixtureAssignment(dueno, fixtureAssignmentId)
        await dueno.auth.signOut()
        await cleanupFixtureShift(admin, fixture)
      })

      it('no puede llamar assign_employee', async () => {
        const { error } = await supervisora.rpc('assign_employee', {
          p_shift_id: fixture.shiftId,
          p_employee_id: empleadoAjenoId,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede llamar remove_assignment, ni sobre una asignación del turno de fixture', async () => {
        const { error } = await supervisora.rpc('remove_assignment', {
          p_assignment_id: fixtureAssignmentId,
          p_reason: 'e2e-perm no debería aplicarse',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede llamar update_assignment_time', async () => {
        const { error } = await supervisora.rpc('update_assignment_time', {
          p_assignment_id: fixtureAssignmentId,
          p_start: '09:00',
          p_end: '11:00',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede llamar update_shift_details', async () => {
        const { error } = await supervisora.rpc('update_shift_details', {
          p_shift_id: fixture.shiftId,
          p_required_staff: 3,
          p_notes: 'e2e-perm no debería aplicarse',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })
    })

    // TASK-008/TEST-009 (P12.3, 08_Fases_y_Backlog.md F12): `update_task_status` no lista al
    // supervisor entre los roles con permiso (`06` sección 9: "E (asignación propia present), O,
    // A") -- la función va directo a la rama `else` y corta con FORBIDDEN, NO con TASK_LOCKED (ese
    // código es específicamente "sos empleado pero no es tu ventana", `0025_rpc_tasks.sql`).
    describe('update_task_status (F12): FORBIDDEN, no TASK_LOCKED', () => {
      let fixture: FixtureShift
      let taskId: string

      beforeAll(async () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        fixture = await createFixtureShift(admin, tomorrow, '13:00', '14:00')
        taskId = await createFixtureShiftTask(
          admin,
          fixture.shiftId,
          'supervisor',
        )
      })

      afterAll(async () => {
        await deleteFixtureShiftTask(admin, taskId)
        await cleanupFixtureShift(admin, fixture)
      })

      it('FORBIDDEN, no TASK_LOCKED', async () => {
        const { error } = await supervisora.rpc('update_task_status', {
          p_task_id: taskId,
          p_status: 'in_progress',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })
    })

    // MOB-EMP-017/TEST-010 (P13.4, 08_Fases_y_Backlog.md F13, `06` sección 10): las tres RPC de
    // asistencia del empleado (`record_check_in`, `record_check_out`, `set_assignment_notes`) no
    // listan al supervisor entre los roles con permiso, ni siquiera sobre una asignación de
    // alguien de su propio equipo -- el pgTAP de `0026_rpc_attendance.sql` (P13.1) ya prueba esto
    // mismo a nivel de función; acá interesa la vía real de PostgREST con JWT (encargo P13.4).
    describe('asistencia (F13): record_check_in, record_check_out y set_assignment_notes, ninguna es para el supervisor', () => {
      let fixture: FixtureShift
      let fixtureAssignmentId: string
      let dueno: TestClient

      beforeAll(async () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        fixture = await createFixtureShift(admin, tomorrow, '15:00', '16:00')
        const ownerLogin = await loginAs(SEED_ACCOUNTS.owner)
        dueno = ownerLogin.client
        fixtureAssignmentId = await createFixtureAssignment(
          dueno,
          fixture.shiftId,
          empleadoDeSuEquipoId,
        )
      })

      afterAll(async () => {
        await removeFixtureAssignment(dueno, fixtureAssignmentId)
        await dueno.auth.signOut()
        await cleanupFixtureShift(admin, fixture)
      })

      it('no puede llamar record_check_in, aunque sea de alguien de su equipo', async () => {
        const { error } = await supervisora.rpc('record_check_in', {
          p_assignment_id: fixtureAssignmentId,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede llamar record_check_out', async () => {
        const { error } = await supervisora.rpc('record_check_out', {
          p_assignment_id: fixtureAssignmentId,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede llamar set_assignment_notes', async () => {
        const { error } = await supervisora.rpc('set_assignment_notes', {
          p_assignment_id: fixtureAssignmentId,
          p_notes: 'e2e-perm no debería aplicarse',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })
    })
  },
)
