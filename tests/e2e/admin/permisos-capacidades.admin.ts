import { expect, test } from '@playwright/test'
import { FIXED_ACCOUNTS, getAdminDb } from '../../fixtures/accounts.ts'
import { callAdminUsers, expectHint } from '../../fixtures/api.ts'
import { FRANJAS, franjaYaEmpezo } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import {
  freshStorageState,
  readId,
  signedClient,
  signInSession,
  storageStatePath,
} from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { chooseMenuItem } from '../../fixtures/ui.ts'

// TEST-016 (P18.1): matriz de permisos de `03_Plan_Maestro_Tecnico.md` sección 6 desde la
// administración, "ni por interfaz ni por API" (RB-A01: "un administrador sin una capacidad no
// puede ejecutar esa acción ni por interfaz ni por API"), y el flujo crítico 2 de la sección
// 14.2: el dueño ajusta capacidades y el efecto se ve en interfaz y en API.
//
// Cuentas fijas: `adminSinCapacidades` (ninguna capacidad), `admin` (las siete, control
// positivo) y `adminCapacidades` (la que el dueño modifica; el test la restituye al terminar).
// Empleado y supervisor de este archivo: empleado1 y supervisor1.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.describe('permisos por capacidad (03 sección 6)', () => {
  test.use({ storageState: storageStatePath('adminSinCapacidades') })

  test(
    'un administrador sin capacidades no ve las acciones reservadas y el servidor las rechaza con FORBIDDEN',
    cubre('RB-A01', 'RB-A04', 'RB-A05', 'RB-A08', 'RB-A09', 'RB-X02', 'CB-17'),
    async ({ page, browser }) => {
      const sc = new Scenario()
      try {
        const client = await sc.client('perm')
        const site = await sc.site(client.id, 'perm')
        const shiftId = await sc.shift(
          client.id,
          site.id,
          sc.today,
          FRANJAS.noche,
        )
        const assignmentId = await sc.assign(shiftId, 'empleado1')
        const supervisionId = await sc.assignSupervision(shiftId, 'supervisor1')

        await test.step('interfaz: ADM-06 no ofrece registrar en nombre, recargar tareas ni asignar supervisión', async () => {
          await page.goto(`/admin/turnos/${shiftId}`)
          const detalle = page.getByRole('dialog', {
            name: 'Detalle del turno',
          })
          await expect(detalle.getByText('Dotación: 1/1')).toBeVisible()
          // Lo que un administrador SIN capacidades sí puede (matriz: "S"): quitar antes del inicio.
          // "Quitar" solo se ofrece antes del inicio del turno.
          if (!franjaYaEmpezo(FRANJAS.noche)) {
            await expect(
              detalle.getByRole('button', { name: 'Quitar' }),
            ).toBeVisible()
          }
          await expect(
            detalle.getByRole('button', { name: 'Registrar en nombre' }),
          ).toHaveCount(0)
          await expect(
            detalle.getByRole('button', { name: 'Recargar tareas' }),
          ).toHaveCount(0)
          await expect(
            detalle.getByRole('link', { name: 'Asignar supervisión' }),
          ).toHaveCount(0)
        })

        await test.step('interfaz: ADM-05 no ofrece Cancelar turno', async () => {
          await page.goto(`/admin/planificacion?vista=dia&fecha=${sc.today}`)
          const fila = page.getByRole('row').filter({ hasText: client.name })
          await expect(fila.getByRole('link', { name: 'Ver' })).toBeVisible()
          await expect(
            fila.getByRole('button', { name: 'Cancelar' }),
          ).toHaveCount(0)
        })

        await test.step('interfaz: ADM-09, ADM-26, ADM-10 y ADM-15 niegan o sacan la acción', async () => {
          await page.goto('/admin/turnos/generar')
          await expect(
            page.getByText('No tenés permiso para generar turnos'),
          ).toBeVisible()

          await page.goto('/admin/tareas')
          await expect(
            page.getByText(
              'No tenés el permiso para editar plantillas de tareas',
            ),
          ).toBeVisible()

          await page.goto('/admin/asistencia')
          await expect(
            page
              .getByRole('row')
              .filter({ hasText: client.name })
              .getByRole('link', {
                name: 'Abrir turno',
              }),
          ).toBeVisible()
          await expect(
            page
              .getByRole('row')
              .filter({ hasText: client.name })
              .getByRole('button', {
                name: 'Registrar en nombre',
              }),
          ).toHaveCount(0)

          await page.goto(`/admin/supervisiones/${supervisionId}`)
          const supervision = page.getByRole('dialog', {
            name: 'Detalle de la supervisión',
          })
          await expect(
            supervision.getByRole('button', {
              name: 'Marcar como no realizada',
            }),
          ).toBeVisible()
          await expect(
            supervision.getByRole('button', { name: 'Cancelar supervisión' }),
          ).toHaveCount(0)

          await page.goto('/admin/configuracion/usuarios')
          await expect(
            page.getByRole('heading', { name: 'Usuarios y roles' }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: /^Acciones para/ }),
          ).toHaveCount(0)
        })

        await test.step('API directa: cada acción reservada responde FORBIDDEN (CB-17)', async () => {
          const api = await signedClient('adminSinCapacidades')
          const other = readId('supervisor2')
          expectHint(
            await api.rpc('cancel_shift', {
              p_shift_id: shiftId,
              p_reason: 'e2e',
            }),
            'FORBIDDEN',
          )
          expectHint(
            await api.rpc('generate_shifts', { p_year: 2193, p_month: 1 }),
            'FORBIDDEN',
          )
          expectHint(
            await api.rpc('admin_record_attendance', {
              p_assignment_id: assignmentId,
              p_kind: 'check_in',
              p_reason: 'e2e',
            }),
            'FORBIDDEN',
          )
          expectHint(
            await api.rpc('close_assignment', {
              p_assignment_id: assignmentId,
              p_reason: 'e2e',
            }),
            'FORBIDDEN',
          )
          expectHint(
            await api.rpc('notify_absence', {
              p_assignment_id: assignmentId,
              p_reason_code: 'illness',
            }),
            'FORBIDDEN',
          )
          expectHint(
            await api.rpc('assign_supervision', {
              p_shift_id: shiftId,
              p_supervisor_id: other,
            }),
            'FORBIDDEN',
          )
          expectHint(
            await api.rpc('cancel_supervision', {
              p_supervision_id: supervisionId,
              p_reason: 'e2e',
            }),
            'FORBIDDEN',
          )
          expectHint(
            await api.rpc('reload_shift_tasks', { p_shift_id: shiftId }),
            'FORBIDDEN',
          )
          expectHint(
            await api.rpc('clone_checklist_template', {
              p_client_id: client.id,
              p_site_id: site.id,
            }),
            'FORBIDDEN',
          )
          expectHint(
            await api.rpc('set_admin_capability', {
              p_profile_id: readId('adminCapacidades'),
              p_capability: 'cancel_shifts',
              p_enabled: false,
            }),
            'FORBIDDEN',
          )
          // RLS: sin `edit_checklists` tampoco puede insertar una plantilla por la tabla.
          const insert = await api
            .from('checklist_templates')
            .insert({ client_id: client.id, name: 'e2e-sin-permiso' })
          expect(insert.error?.code, 'RLS tiene que negar el insert').toBe(
            '42501',
          )

          // La Edge Function también lo rechaza (sin `manage_users`).
          const session = await signInSession(
            FIXED_ACCOUNTS.adminSinCapacidades.email,
          )
          const edge = await callAdminUsers(
            session.access_token,
            'sign_out_user',
            {
              profile_id: readId('empleado1'),
            },
          )
          expect(edge.status).toBe(403)
          expect(edge.body.error?.hint).toBe('FORBIDDEN')
        })

        await test.step('control positivo: el administrador con las siete capacidades sí ve y puede', async () => {
          const ctx = await browser.newContext({
            storageState: storageStatePath('admin'),
          })
          const adminPage = await ctx.newPage()
          try {
            await adminPage.goto(`/admin/turnos/${shiftId}`)
            const detalle = adminPage.getByRole('dialog', {
              name: 'Detalle del turno',
            })
            await expect(
              detalle.getByRole('button', { name: 'Registrar en nombre' }),
            ).toBeVisible()
            await expect(
              detalle.getByRole('button', { name: 'Recargar tareas' }),
            ).toBeVisible()
            await expect(
              detalle.getByRole('link', { name: 'Asignar supervisión' }),
            ).toBeVisible()
            await adminPage.goto(
              `/admin/planificacion?vista=dia&fecha=${sc.today}`,
            )
            await expect(
              adminPage
                .getByRole('row')
                .filter({ hasText: client.name })
                .getByRole('button', { name: 'Cancelar' }),
            ).toBeVisible()
          } finally {
            await ctx.close()
          }
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('el dueño ajusta capacidades: efecto en interfaz y en API (flujo crítico 2)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'al quitarle "Cancelar turnos" al administrador, con sesión nueva ya no ve Cancelar y cancel_shift responde FORBIDDEN',
    cubre('RB-A01', 'RB-A04', 'CB-17', 'P-022'),
    async ({ page, browser }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      const db = getAdminDb()
      const target = FIXED_ACCOUNTS.adminCapacidades
      try {
        const client = await sc.client('caps')
        const site = await sc.site(client.id, 'caps')
        const shiftA = await sc.shift(
          client.id,
          site.id,
          sc.today,
          FRANJAS.noche,
        )
        const shiftB = await sc.shift(
          client.id,
          site.id,
          sc.today,
          FRANJAS.manana,
        )

        await test.step('antes: con la capacidad, cancela por API y ve "Cancelar" en ADM-05', async () => {
          const api = await signedClient('adminCapacidades')
          const cancelled = await api.rpc('cancel_shift', {
            p_shift_id: shiftA,
            p_reason: 'e2e: control positivo antes de quitar la capacidad',
          })
          expect(cancelled.error, cancelled.error?.message).toBeNull()

          const ctx = await browser.newContext({
            storageState: await freshStorageState('adminCapacidades'),
          })
          const adminPage = await ctx.newPage()
          try {
            await adminPage.goto(
              `/admin/planificacion?vista=dia&fecha=${sc.today}`,
            )
            await expect(
              adminPage
                .getByRole('row')
                .filter({ hasText: client.name })
                .getByRole('button', { name: 'Cancelar' }),
            ).toBeVisible()
          } finally {
            await ctx.close()
          }
        })

        await test.step('el dueño desactiva "Cancelar turnos" desde ADM-27', async () => {
          await page.goto('/admin/configuracion/usuarios')
          await chooseMenuItem(
            page,
            `Acciones para ${target.firstName} ${target.lastName}`,
            'Editar roles y capacidades',
          )
          await expect(page.getByRole('switch').first()).toBeVisible()
          const toggle = page.getByRole('switch', { name: /Cancelar turnos/i })
          await expect(toggle).toBeChecked()
          await toggle.click()
          await expect(toggle).not.toBeChecked()
          await page.getByRole('button', { name: 'Cerrar' }).first().click()

          // Confirmación en la base: la capacidad quedó apagada.
          await expect
            .poll(async () => {
              const { data } = await db
                .from('admin_capabilities')
                .select('enabled')
                .eq('profile_id', readId('adminCapacidades'))
                .eq('capability', 'cancel_shifts')
                .single()
              return data?.enabled
            })
            .toBe(false)
        })

        await test.step('después: con sesión nueva, ya no ve "Cancelar" y el servidor responde FORBIDDEN', async () => {
          const ctx = await browser.newContext({
            storageState: await freshStorageState('adminCapacidades'),
          })
          const adminPage = await ctx.newPage()
          try {
            await adminPage.goto(
              `/admin/planificacion?vista=dia&fecha=${sc.today}`,
            )
            const fila = adminPage
              .getByRole('row')
              .filter({ hasText: client.name })
            await expect(
              fila.getByRole('link', { name: 'Ver' }).first(),
            ).toBeVisible()
            await expect(
              fila.getByRole('button', { name: 'Cancelar' }),
            ).toHaveCount(0)
          } finally {
            await ctx.close()
          }
          const api = await signedClient('adminCapacidades')
          expectHint(
            await api.rpc('cancel_shift', {
              p_shift_id: shiftB,
              p_reason: 'e2e',
            }),
            'FORBIDDEN',
          )
        })
      } finally {
        // Restituye el estado inicial de la cuenta fija pase lo que pase.
        await db
          .from('admin_capabilities')
          .update({ enabled: true })
          .eq('profile_id', readId('adminCapacidades'))
          .eq('capability', 'cancel_shifts')
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
