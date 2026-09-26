// tests/permissions/employee.permissions.ts — P04.7 (08_Fases_y_Backlog.md, F4)
//
// Verificación independiente (la escribe qa-pruebas, no backend-supabase) del criterio de
// aceptación de F4: "Un empleado del seed, autenticado, no puede leer `ratings` ni asignaciones
// ajenas (test)" (08_Fases_y_Backlog.md). Cubre también, con el mismo criterio, otras tablas de
// 04_Modelo_de_Datos.md sección 7.2 donde el empleado NO tiene acceso o solo tiene acceso
// parcial -- representativo, no exhaustivo: la suite completa por tabla y por RPC es TEST-019
// (F18), que esta tarea adelanta parcialmente (P04.7).
//
// Cada caso queda anotado con la fila de trazabilidad (09_Trazabilidad.md) o el caso borde
// (08_Fases_y_Backlog.md sección 3) que cubre. Regla de independencia: usa las cuentas fijas del
// seed (no crea personas), pero cualquier dato que modifica (teléfono propio, nota de una
// asignación propia) lo deja como estaba al final de cada test.
//
// Empleado principal: maria.gomez (SEED_ACCOUNTS.employees[0]). "Otro empleado" (ajeno, sin
// turnos en común -- verificado en el reporte de esta tarea: el seed actual da un turno por
// asignación, así que ningún par de empleados comparte turno hoy): juan.perez.

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
if (!env) console.warn(missingEnvWarning('employee.permissions.ts'))

describe.skipIf(!env)(
  'rol employee — permisos por API directa contra App_dev',
  () => {
    let admin: TestClient
    let empleado: TestClient
    let empleadoId: string
    let otroEmpleadoId: string

    beforeAll(async () => {
      admin = createAdminClient()
      const login = await loginAs(SEED_ACCOUNTS.employees[0])
      empleado = login.client
      empleadoId = login.userId
      otroEmpleadoId = await resolveUserId(admin, SEED_ACCOUNTS.employees[1])
    })

    afterAll(async () => {
      await empleado.auth.signOut()
    })

    describe('lo que NO puede hacer (cero filas o FORBIDDEN)', () => {
      it('CB-15 / RB-X02: no lee ninguna fila de ratings, aunque existan calificaciones reales (04 sección 7.2, P-084)', async () => {
        // Confirma primero que la tabla tiene datos reales protegidos: si estuviera vacía, un
        // `deny all` accidental pasaría este test igual y no probaría nada (04 sección 7.2:
        // "ratings | ... E: no (P-084)").
        const real = await admin
          .from('ratings')
          .select('id', { count: 'exact', head: true })
        expect(real.count ?? 0).toBeGreaterThan(0)

        const { data, error } = await empleado.from('ratings').select('*')
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it('RB-X02: no lee asignaciones de un empleado con el que no comparte turno', async () => {
        const { data, error } = await empleado
          .from('assignments')
          .select('*')
          .eq('employee_id', otroEmpleadoId)
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it('no lee el perfil completo de alguien que no es compañero de turno', async () => {
        const { data, error } = await empleado
          .from('profiles')
          .select('*')
          .eq('id', otroEmpleadoId)
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it('no lee supervisiones (04 sección 7.2: "supervisions | ... E: no")', async () => {
        const { data, error } = await empleado.from('supervisions').select('*')
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it('no lee criterios de calificación (04 sección 7.2: "rating_criteria | O, A, S ... E: no")', async () => {
        const { data, error } = await empleado
          .from('rating_criteria')
          .select('*')
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it('no lee eventos de seguridad (04 sección 7.2: "security_events | O.")', async () => {
        const { data, error } = await empleado
          .from('security_events')
          .select('*')
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it('CB-17 / RB-A01: no puede llamar set_admin_capability, RPC fuera de su rol', async () => {
        const { error } = await empleado.rpc('set_admin_capability', {
          p_profile_id: empleadoId,
          p_capability: 'manage_users',
          p_enabled: true,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('RB-A01: no puede subirse el propio rol a owner con set_user_roles', async () => {
        const { error } = await empleado.rpc('set_user_roles', {
          p_profile_id: empleadoId,
          p_roles: ['owner'],
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede insertar un cliente por API directa (04 sección 7.2: "clients | ... | O, A.")', async () => {
        const { error } = await empleado.from('clients').insert({
          legal_name: 'e2e-perm no debería crearse',
          trade_name: 'e2e-perm',
          cuit: '20111111112',
        })
        expect(error?.code).toBe('42501')
      })

      it('no puede editar shifts.notes por API directa (tabla "RPC" en 04 sección 7.2, sin política de escritura para nadie todavía)', async () => {
        const { error } = await empleado
          .from('shifts')
          .update({ notes: 'e2e-perm no debería aplicarse' })
          .eq('id', '00000000-0000-0000-0000-000000000000') // cualquier uuid: el permiso de tabla falla antes de mirar la fila
        expect(error?.code).toBe('42501')
      })

      it('no puede editar su propio perfil fuera de las columnas permitidas (is_active)', async () => {
        const { error } = await empleado
          .from('profiles')
          .update({ is_active: false })
          .eq('id', empleadoId)
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede editar sus propios datos laborales en employees (04 sección 7.2: "employees | ... | O, A")', async () => {
        const before = await admin
          .from('employees')
          .select('employee_number')
          .eq('profile_id', empleadoId)
          .single()

        const { data, error } = await empleado
          .from('employees')
          .update({ employee_number: 999999 })
          .eq('profile_id', empleadoId)
          .select()
        expect(error).toBeNull()
        // RLS lo bloquea en silencio: el grant de UPDATE existe (para que O/A puedan editar
        // cualquier fila), pero la política `employees_update_admin` exige `app.is_admin()` -- un
        // empleado que intenta tocar su propia fila obtiene 0 filas afectadas, sin error.
        expect(data).toEqual([])

        const after = await admin
          .from('employees')
          .select('employee_number')
          .eq('profile_id', empleadoId)
          .single()
        expect(after.data?.employee_number).toBe(before.data?.employee_number)
      })

      // P10.4 (08_Fases_y_Backlog.md F10): las cinco RPC de turnos de `0023_rpc_shifts.sql`
      // (06_API.md sección 7) no tenían ningún caso negativo en esta suite todavía -- sumados acá
      // por TEST-007 (encargo P10.4, "si la suite de permisos por API no cubre las RPC nuevas
      // contra cada rol, sumá esos casos"). `p_shift_id`/`p_client_id`/etc. son uuids cualquiera:
      // `app.require_role`/`app.require_capability` cortan ANTES de mirar si esos ids existen de
      // verdad (mismo criterio que el caso de `shifts.notes` de arriba, "cualquier uuid: el
      // permiso falla antes de mirar la fila").
      const ANY_UUID = '00000000-0000-0000-0000-000000000000'

      it('no puede llamar create_shift (06 sección 7: "O, A" a secas, sin rol para empleado)', async () => {
        const { error } = await empleado.rpc('create_shift', {
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
        const { error } = await empleado.rpc('generate_shifts', {
          p_year: 2190,
          p_month: 6,
        })
        expect(error?.hint ?? error?.message).toMatch(/FORBIDDEN/i)
      })

      it('no puede llamar update_shift_time (06 sección 7: "O, A")', async () => {
        const { error } = await empleado.rpc('update_shift_time', {
          p_shift_id: ANY_UUID,
          p_start: '08:00',
          p_end: '12:00',
        })
        expect(error?.hint ?? error?.message).toMatch(/FORBIDDEN/i)
      })

      it('no puede llamar cancel_shift (06 sección 7: "O; A + cancel_shifts")', async () => {
        const { error } = await empleado.rpc('cancel_shift', {
          p_shift_id: ANY_UUID,
          p_reason: 'e2e-perm no debería aplicarse',
        })
        expect(error?.hint ?? error?.message).toMatch(/FORBIDDEN/i)
      })

      it('no puede llamar reload_shift_tasks (06 sección 7: "O; A + edit_checklists")', async () => {
        const { error } = await empleado.rpc('reload_shift_tasks', {
          p_shift_id: ANY_UUID,
        })
        expect(error?.hint ?? error?.message).toMatch(/FORBIDDEN/i)
      })

      // TASK-008/TEST-009 (P12.3, 08_Fases_y_Backlog.md F12): `checklist_templates`/
      // `checklist_template_items` no tienen ninguna política de escritura para el empleado (04
      // sección 7.2: "O, A con edit_checklists"), y `clone_checklist_template` exige esa misma
      // capacidad (`app.require_capability`, que ya corta antes de mirar el rol) -- ningún
      // empleado la tiene nunca.
      it('no puede insertar una plantilla de tareas por API directa (04 sección 7.2: "checklist_templates... O, A con edit_checklists")', async () => {
        const { error } = await empleado.from('checklist_templates').insert({
          client_id: ANY_UUID,
          site_id: null,
          name: 'e2e-perm no debería crearse',
        })
        expect(error?.code).toBe('42501')
      })

      it('no puede insertar un ítem de plantilla por API directa', async () => {
        const { error } = await empleado
          .from('checklist_template_items')
          .insert({
            template_id: ANY_UUID,
            position: 0,
            title: 'e2e-perm no debería crearse',
          })
        expect(error?.code).toBe('42501')
      })

      it('no puede llamar clone_checklist_template (06 sección 9: "O; A + edit_checklists")', async () => {
        const { error } = await empleado.rpc('clone_checklist_template', {
          p_client_id: ANY_UUID,
          p_site_id: ANY_UUID,
        })
        expect(error?.hint ?? error?.message).toMatch(/FORBIDDEN/i)
      })

      it('no puede insertar un servicio por API directa (06 sección 6: "Crear, editar | O, A")', async () => {
        const { error } = await empleado.from('services').insert({
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
    })

    describe('lo que SÍ puede hacer (contraprueba: que un "denegar todo" no pase el bloque de arriba)', () => {
      it('lee su propio perfil', async () => {
        const { data, error } = await empleado
          .from('profiles')
          .select('*')
          .eq('id', empleadoId)
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
      })

      it('lee sus propios datos laborales en employees', async () => {
        const { data, error } = await empleado
          .from('employees')
          .select('*')
          .eq('profile_id', empleadoId)
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
      })

      it('RB-X02: lee exactamente sus propias asignaciones vigentes, ni una de más ni una de menos', async () => {
        const mine = await empleado.from('assignments').select('id')
        expect(mine.error).toBeNull()

        const expected = await admin
          .from('assignments')
          .select('id')
          .eq('employee_id', empleadoId)
          .is('removed_at', null)

        const mineRows = (mine.data ?? []) as { id: string }[]
        const expectedRows = (expected.data ?? []) as { id: string }[]
        const mineIds = new Set(mineRows.map((r) => r.id))
        const expectedIds = new Set(expectedRows.map((r) => r.id))
        expect(mineIds).toEqual(expectedIds)
        // Si esto diera 0, el caso de arriba (mineIds === expectedIds con ambos vacíos) no
        // probaría nada: confirma que el empleado de prueba tiene asignaciones reales en el seed.
        expect(mineIds.size).toBeGreaterThan(0)
      })

      it('lee los feriados (04 sección 7.2: "holidays | Todos autenticados.")', async () => {
        const { count, error } = await empleado
          .from('holidays')
          .select('id', { count: 'exact', head: true })
        expect(error).toBeNull()
        expect(count ?? 0).toBeGreaterThan(0)
      })

      it('lee la configuración de la empresa (04 sección 7.2: "company_settings | Todos autenticados")', async () => {
        const { data, error } = await empleado
          .from('company_settings')
          .select('*')
          .eq('id', 1)
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
      })

      it('edita el teléfono de su propio perfil, columna permitida', async () => {
        const nuevo = '+54 9 11 0000-0000'
        const { data, error } = await empleado
          .from('profiles')
          .update({ phone: nuevo })
          .eq('id', empleadoId)
          .select()
        expect(error).toBeNull()
        expect(data?.[0]?.phone).toBe(nuevo)

        // Limpieza (regla de independencia): deja el teléfono como estaba.
        await empleado
          .from('profiles')
          .update({ phone: null })
          .eq('id', empleadoId)
      })

      // Actualizado en P13.4 (MOB-EMP-017/TEST-010): desde `0026_rpc_attendance.sql` (P13.1),
      // `notes` se escribe SOLO por `set_assignment_notes` -- la migración le sacó a propósito la
      // política `assignments_update_own_notes` y el `grant update (notes)` que este caso probaba
      // hasta P12 (ver el reporte de P13.1: "se quitaron... `notes` se escribe solo por la RPC").
      // Un `update` directo sobre esa columna ahora tiene que rechazarse con `42501`, no con éxito
      // silencioso ni con 0 filas -- eso mismo se agrega como caso negativo más abajo.
      it('edita la nota de una asignación propia con turno todavía no completado, por set_assignment_notes (06 sección 10, P-062)', async () => {
        const propias = await admin
          .from('assignments')
          .select('id, shift_id')
          .eq('employee_id', empleadoId)
          .is('removed_at', null)
        const propiasRows = (propias.data ?? []) as {
          id: string
          shift_id: string
        }[]
        const shiftIds = propiasRows.map((a) => a.shift_id)

        const noCompletados = await admin
          .from('shifts')
          .select('id')
          .in('id', shiftIds)
          .neq('status', 'completed')
        const noCompletadosRows = (noCompletados.data ?? []) as { id: string }[]
        const idsNoCompletados = new Set(noCompletadosRows.map((s) => s.id))
        const candidata = propiasRows.find((a) =>
          idsNoCompletados.has(a.shift_id),
        )

        expect(
          candidata,
          'el seed necesita al menos una asignación propia con turno no completado',
        ).toBeDefined()
        if (!candidata) return

        const nota = 'e2e-perm nota de prueba'
        const { data, error } = await empleado.rpc('set_assignment_notes', {
          p_assignment_id: candidata.id,
          p_notes: nota,
        })
        expect(error).toBeNull()
        expect(data?.notes).toBe(nota)

        // Limpieza.
        await empleado.rpc('set_assignment_notes', {
          p_assignment_id: candidata.id,
          p_notes: '',
        })
      })

      it('un update directo de assignments.notes ya no funciona (42501): la única vía de escritura es set_assignment_notes', async () => {
        const propias = await admin
          .from('assignments')
          .select('id')
          .eq('employee_id', empleadoId)
          .is('removed_at', null)
          .limit(1)
          .single()
        expect(propias.data).toBeDefined()
        if (!propias.data) return

        const { error } = await empleado
          .from('assignments')
          .update({ notes: 'e2e-perm no debería aplicarse' })
          .eq('id', propias.data.id)
        expect(error?.code).toBe('42501')
      })

      it('llama mark_changes_seen() sobre sí mismo', async () => {
        const { data, error } = await empleado.rpc('mark_changes_seen')
        expect(error).toBeNull()
        expect(data?.id).toBe(empleadoId)
      })
    })

    // ASSIGN-015/TEST-008 (P11.4, 08_Fases_y_Backlog.md F11): un empleado no tiene ningún canal
    // para asignar, quitar ni editar turnos/asignaciones -- ni siquiera las propias (`06` sección
    // 8: "assign_employee/remove_assignment/update_assignment_time | O, A" a secas,
    // `update_shift_details | O, A"): ninguna fila dice "E"). Turno y asignación de fixture
    // propios (no del seed), para no depender de qué turnos reales tenga hoy `maria.gomez`.
    describe('las cuatro RPC de asignaciones (06 sección 8): ninguna es para el rol employee', () => {
      let fixture: FixtureShift
      let fixtureAssignmentId: string
      let dueno: TestClient

      beforeAll(async () => {
        // Mañana, de madrugada (03:00-04:00): horario del que casi con certeza nadie del seed
        // tiene un turno real hoy (que sí podría chocar con `ASSIGNMENT_OVERLAP` si se usara una
        // franja diurna típica de limpieza, ya observado armando esta suite).
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        fixture = await createFixtureShift(admin, tomorrow, '03:00', '04:00')
        // La asignación de fixture se arma con el dueño (la única cuenta que puede insertar en
        // `assignments`, ver el comentario de `createFixtureAssignment`): `service_role` no
        // tiene permiso sobre el schema `app` que necesita el trigger de esa tabla.
        const ownerLogin = await loginAs(SEED_ACCOUNTS.owner)
        dueno = ownerLogin.client
        fixtureAssignmentId = await createFixtureAssignment(
          dueno,
          fixture.shiftId,
          otroEmpleadoId,
        )
      })

      afterAll(async () => {
        await removeFixtureAssignment(dueno, fixtureAssignmentId)
        await dueno.auth.signOut()
        await cleanupFixtureShift(admin, fixture)
      })

      it('RB-ASSIGN-012: no puede llamar assign_employee, ni para sí mismo', async () => {
        const { error } = await empleado.rpc('assign_employee', {
          p_shift_id: fixture.shiftId,
          p_employee_id: empleadoId,
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('RB-ASSIGN-013: no puede llamar remove_assignment sobre una asignación ajena', async () => {
        const { error } = await empleado.rpc('remove_assignment', {
          p_assignment_id: fixtureAssignmentId,
          p_reason: 'e2e-perm no debería aplicarse',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('no puede llamar update_assignment_time sobre una asignación ajena', async () => {
        const { error } = await empleado.rpc('update_assignment_time', {
          p_assignment_id: fixtureAssignmentId,
          p_start: '09:00',
          p_end: '11:00',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })

      it('RB-ASSIGN-013b: no puede llamar update_shift_details', async () => {
        const { error } = await empleado.rpc('update_shift_details', {
          p_shift_id: fixture.shiftId,
          p_required_staff: 3,
          p_notes: 'e2e-perm no debería aplicarse',
        })
        expect(error?.hint).toBe('FORBIDDEN')
      })
    })

    // TASK-008/TEST-009 (P12.3, 08_Fases_y_Backlog.md F12): `update_task_status` es la única RPC
    // de este dominio donde el empleado SÍ tiene un canal, acotado a su propia ventana (04 sección
    // 6.3, P-063: asignación vigente en `present` en el turno de la tarea). Dos turnos de fixture
    // propios: uno sin ninguna asignación de maria.gomez (TASK_LOCKED) y otro con una asignación
    // suya forzada a `present` con la clave de servicio -- `record_check_in` todavía no existe
    // (F13) -- tocando solo la columna `status` (no dispara el trigger `column-specific`
    // `app.sync_assignment_window`, mismo criterio que `releaseAssignmentAfterCancelledShift` de
    // `tests/e2e-assignments/helpers/adminClient.ts`). Por el mismo motivo, la limpieza libera esa
    // asignación con un `update` directo (`remove_assignment` la rechazaría con
    // `ASSIGNMENT_STARTED`: `status in ('present','finished')`, `0024_rpc_assignments.sql`).
    describe('update_task_status (F12): TASK_LOCKED sin asignación present, éxito con ella', () => {
      let lockedShift: FixtureShift
      let lockedTaskId: string
      let presentShift: FixtureShift
      let presentTaskId: string
      let presentAssignmentId: string
      let dueno: TestClient
      let duenoId: string

      beforeAll(async () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        lockedShift = await createFixtureShift(
          admin,
          tomorrow,
          '10:00',
          '11:00',
        )
        lockedTaskId = await createFixtureShiftTask(
          admin,
          lockedShift.shiftId,
          'locked',
        )

        // Madrugada (02:00-03:00): horario del que casi con certeza nadie del seed tiene un
        // turno real hoy (mismo criterio que el resto de esta carpeta) -- acá importa de verdad
        // porque esta asignación SÍ es real (`assign_employee`), a diferencia de `lockedShift`
        // (sin ninguna asignación): una franja diurna típica de limpieza ya chocó con
        // `ASSIGNMENT_OVERLAP`/"turno real" corriendo esta suite (ver el reporte del encargo).
        presentShift = await createFixtureShift(
          admin,
          tomorrow,
          '02:00',
          '03:00',
        )
        presentTaskId = await createFixtureShiftTask(
          admin,
          presentShift.shiftId,
          'present',
        )

        const ownerLogin = await loginAs(SEED_ACCOUNTS.owner)
        dueno = ownerLogin.client
        duenoId = ownerLogin.userId
        presentAssignmentId = await createFixtureAssignment(
          dueno,
          presentShift.shiftId,
          empleadoId,
        )
        const { error: statusError } = await admin
          .from('assignments')
          .update({ status: 'present' })
          .eq('id', presentAssignmentId)
        if (statusError) {
          throw new Error(
            `No se pudo forzar la asignación a present: ${statusError.message}`,
          )
        }
      })

      afterAll(async () => {
        // `removed_by` es obligatorio junto con `removed_at` (check de la tabla,
        // `0007_services_shifts_assignments.sql`): sin él, el `update` fallaba en silencio (no se
        // revisaba el error acá) y la asignación quedaba vigente de corrida en corrida -- la
        // siguiente chocaba con "el empleado ya tiene otro turno en ese horario"
        // (`ASSIGNMENT_OVERLAP`, encontrado corriendo esta suite tres veces seguidas, ver el
        // reporte del encargo).
        const { error: releaseError } = await admin
          .from('assignments')
          .update({
            removed_at: new Date().toISOString(),
            removed_by: duenoId,
            removed_reason:
              'e2e-perm: limpieza de la asignación forzada a present',
          })
          .eq('id', presentAssignmentId)
        if (releaseError) {
          throw new Error(
            `No se pudo liberar la asignación de fixture en la limpieza: ${releaseError.message}`,
          )
        }
        await dueno.auth.signOut()
        await deleteFixtureShiftTask(admin, lockedTaskId)
        await deleteFixtureShiftTask(admin, presentTaskId)
        await cleanupFixtureShift(admin, lockedShift)
        await cleanupFixtureShift(admin, presentShift)
      })

      it('TASK_LOCKED: sin ninguna asignación vigente en ese turno', async () => {
        const { error } = await empleado.rpc('update_task_status', {
          p_task_id: lockedTaskId,
          p_status: 'in_progress',
        })
        expect(error?.hint).toBe('TASK_LOCKED')
      })

      it('con una asignación vigente en present, cambia el estado de la tarea de ESE turno', async () => {
        const { data, error } = await empleado.rpc('update_task_status', {
          p_task_id: presentTaskId,
          p_status: 'done',
        })
        expect(error).toBeNull()
        expect(data?.status).toBe('done')
      })
    })
  },
)
