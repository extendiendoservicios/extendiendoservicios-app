import { expect, test } from '@playwright/test'
import { nombreDe, reNombreDe } from '../fixtures/accounts.ts'
import { expectHint } from '../fixtures/api.ts'
import { daysFromToday, FRANJAS } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import {
  crearLicencia,
  darDeBajaLicencias,
  elegirDia,
  fechaDelAnio,
  PREFIJO,
} from './helpers/dia.ts'

// P19.11g · Las licencias bloquean (0059, 0061 y P19.11d, punto 4 de la reunión del 19 oct) y el
// imprimible «Licencias y ausencias» (punto 2).
//   - Al guardar una licencia sobre un turno ya asignado aparece el aviso con «Abrir turno»; no se
//     desasigna nada.
//   - En «Nuevo turno» y en «Asignar empleado» la persona de licencia sale deshabilitada con «De
//     licencia»; el servidor la rechaza con ON_LEAVE.
//   - En «Asignar supervisión» el coordinador de licencia sale deshabilitado (0061).
//   - El imprimible muestra la licencia y la ausencia con su certificado.
// Fechas futuras recortadas al día; las licencias de la prueba llevan el motivo «E2E-P1911 …» y se
// dan de baja al final (baja lógica, nada se borra). Cuentas: admin, owner, empleado1 a empleado4,
// supervisor1.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

test.describe('licencias que bloquean (ADM-17, ADM-07, ADM-08, ADM-14)', () => {
  test(
    'al guardar una licencia sobre un turno asignado aparece el aviso con «Abrir turno» y no se desasigna a nadie',
    cubre('RB-A04', 'RB-A03', 'CB-25', 'P-033'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const dia = daysFromToday(6)
        const cliente = await sc.client('p1911-licencia')
        const sede = await sc.site(cliente.id, 'p1911-licencia')
        const turno = await sc.shift(cliente.id, sede.id, dia, FRANJAS.manana)
        await sc.assign(turno, 'empleado1')

        await page.goto(`/admin/empleados/${readId('empleado1')}`)
        await page.getByRole('tab', { name: 'Licencias' }).click()

        await test.step('una licencia sin turnos en esas fechas no muestra aviso', async () => {
          await page.getByLabel('Desde').fill(daysFromToday(40))
          await page.getByLabel('Hasta (opcional)').fill(daysFromToday(41))
          await page
            .getByLabel('Motivo (opcional)')
            .fill(`${PREFIJO} sin turnos`)
          await page.getByRole('button', { name: 'Agregar licencia' }).click()
          await expect(page.getByText('Agregamos la licencia.')).toBeVisible()
          await expect(
            page.getByText(/turnos? asignados? en las fechas de la licencia/),
          ).toHaveCount(0)
        })

        await test.step('una licencia sobre el turno asignado avisa y deja abrir el turno', async () => {
          await page.getByLabel('Desde').fill(daysFromToday(5))
          await page.getByLabel('Hasta (opcional)').fill(daysFromToday(7))
          await page
            .getByLabel('Motivo (opcional)')
            .fill(`${PREFIJO} con turno`)
          await page.getByRole('button', { name: 'Agregar licencia' }).click()
          await expect(
            page.getByText(
              'Esta persona tiene 1 turno asignado en las fechas de la licencia.',
            ),
          ).toBeVisible()
          await expect(
            page.getByText(cliente.name, { exact: false }),
          ).toBeVisible()
          await expect(page.getByText('08:00–12:00')).toBeVisible()
          const abrir = page.getByRole('link', { name: 'Abrir turno' })
          await expect(abrir).toHaveAttribute('href', `/admin/turnos/${turno}`)

          // No se desasignó nada.
          const { data } = await sc.db
            .from('assignments')
            .select('id')
            .eq('shift_id', turno)
            .is('removed_at', null)
          expect(data).toHaveLength(1)

          await abrir.click()
          await expect(
            page.getByRole('dialog', { name: 'Detalle del turno' }),
          ).toBeVisible()
        })
      } finally {
        expect(await darDeBajaLicencias('empleado1'), 'bajas').toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'en «Nuevo turno» la persona de licencia sale deshabilitada con «De licencia»',
    cubre('RB-A04', 'CB-25', 'P-033'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const dia = daysFromToday(8)
        const cliente = await sc.client('p1911-nuevo')
        await sc.site(cliente.id, 'p1911-nuevo')
        await crearLicencia('empleado2', dia, dia)

        await page.goto(`/admin/turnos/nuevo?fecha=${dia}`)
        await page.getByRole('combobox', { name: 'Cliente' }).click()
        await page.getByRole('option', { name: cliente.name }).click()
        await page
          .getByRole('combobox', { name: 'Empleados del turno' })
          .click()

        const deLicencia = page.getByRole('option', {
          name: reNombreDe('empleado2'),
        })
        await expect(deLicencia).toBeVisible()
        await expect(deLicencia).toHaveAttribute('aria-disabled', 'true')
        await expect(deLicencia).toContainText('De licencia')
        const disponible = page.getByRole('option', {
          name: reNombreDe('empleado3'),
        })
        await expect(disponible).not.toHaveAttribute('aria-disabled', 'true')
        await expect(disponible).not.toContainText('De licencia')

        await test.step('si la licencia no cubre el día elegido, se puede elegir', async () => {
          await page.keyboard.press('Escape')
          await page.goto(`/admin/turnos/nuevo?fecha=${daysFromToday(9)}`)
          await page.getByRole('combobox', { name: 'Cliente' }).click()
          await page.getByRole('option', { name: cliente.name }).click()
          await page
            .getByRole('combobox', { name: 'Empleados del turno' })
            .click()
          const libre = page.getByRole('option', {
            name: reNombreDe('empleado2'),
          })
          await expect(libre).toBeVisible()
          await expect(libre).not.toHaveAttribute('aria-disabled', 'true')
        })
      } finally {
        expect(await darDeBajaLicencias('empleado2'), 'bajas').toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'en «Asignar empleado» la persona de licencia sale deshabilitada con «De licencia» y el servidor la rechaza (ON_LEAVE)',
    cubre('RB-A04', 'CB-25', 'P-033'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const dia = daysFromToday(10)
        const cliente = await sc.client('p1911-asignar')
        const sede = await sc.site(cliente.id, 'p1911-asignar')
        const turno = await sc.shift(cliente.id, sede.id, dia, FRANJAS.manana)
        await crearLicencia('empleado3', dia, dia)

        await page.goto(`/admin/turnos/${turno}`)
        const detalle = page.getByRole('dialog', { name: 'Detalle del turno' })
        await detalle.getByRole('button', { name: 'Asignar empleado' }).click()
        const hoja = page.getByRole('dialog', { name: 'Asignar empleado' })
        const licencia = hoja.getByRole('radio', {
          name: reNombreDe('empleado3'),
        })
        await expect(licencia).toBeDisabled()
        await expect(licencia).toContainText('De licencia')
        await expect(
          hoja.getByRole('radio', { name: reNombreDe('empleado4') }),
        ).toBeEnabled()

        const owner = await sessionClient('owner')
        const respuesta = await owner.rpc('assign_employee', {
          p_shift_id: turno,
          p_employee_id: readId('empleado3'),
        })
        expectHint(respuesta, 'ON_LEAVE')
        expect(respuesta.error?.message).toContain('de licencia')
        const { data } = await sc.db
          .from('assignments')
          .select('id')
          .eq('shift_id', turno)
          .is('removed_at', null)
        expect(data).toHaveLength(0)
      } finally {
        expect(await darDeBajaLicencias('empleado3'), 'bajas').toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'en «Asignar supervisión» el coordinador de licencia sale deshabilitado y el servidor lo rechaza (ON_LEAVE)',
    cubre('RB-S02', 'RB-A04', 'CB-25', 'P-033'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const dia = daysFromToday(11)
        const cliente = await sc.client('p1911-coord')
        const sede = await sc.site(cliente.id, 'p1911-coord')
        const turno = await sc.shift(cliente.id, sede.id, dia, FRANJAS.manana)
        await crearLicencia('supervisor1', dia, dia)

        await page.goto('/admin/supervisiones')
        await page.getByRole('link', { name: 'Asignar supervisión' }).click()
        const hoja = page.getByRole('dialog', { name: 'Asignar supervisión' })
        await elegirDia(page, 'Fecha del turno', dia)
        await hoja.getByRole('combobox', { name: 'Turno' }).click()
        await page
          .getByRole('option', {
            name: new RegExp(`${cliente.name}.*${sede.name}.*08:00–12:00`),
          })
          .click()
        await hoja.getByRole('combobox', { name: 'Coordinador' }).click()
        const coordinador = page.getByRole('option', {
          name: new RegExp(`${nombreDe('supervisor1')}.*De licencia`),
        })
        await expect(coordinador).toBeVisible()
        await expect(coordinador).toHaveAttribute('aria-disabled', 'true')
        await page.keyboard.press('Escape')

        await test.step('por API directa el servidor lo rechaza con ON_LEAVE y no queda supervisión', async () => {
          const owner = await sessionClient('owner')
          const respuesta = await owner.rpc('assign_supervision', {
            p_shift_id: turno,
            p_supervisor_id: readId('supervisor1'),
          })
          expectHint(respuesta, 'ON_LEAVE')
          expect(respuesta.error?.message).toContain('coordinador')
          const { data } = await sc.db
            .from('supervisions')
            .select('id')
            .eq('shift_id', turno)
          expect(data).toHaveLength(0)
        })
      } finally {
        expect(await darDeBajaLicencias('supervisor1'), 'bajas').toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('imprimible «Licencias y ausencias» (ADM-17)', () => {
  test(
    'la hoja muestra la licencia y la ausencia con su certificado, y quién la cargó',
    cubre('RB-A06', 'RB-A08', 'P-033', 'P-073'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const diaTurno = fechaDelAnio(3)
        const desde = fechaDelAnio(15)
        const hasta = fechaDelAnio(17)
        const cliente = await sc.client('p1911-hoja')
        const sede = await sc.site(cliente.id, 'p1911-hoja')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          diaTurno,
          FRANJAS.tarde,
        )
        const asignacion = await sc.assign(turno, 'empleado4')
        const admin = await sessionClient('admin')
        const aviso = await admin.rpc('notify_absence', {
          p_assignment_id: asignacion,
          p_reason_code: 'illness',
          p_has_certificate: true,
        })
        expect(aviso.error, aviso.error?.message).toBeNull()
        // La licencia está lejos del turno: así la carga de la licencia no choca con él.
        await crearLicencia('empleado4', desde, hasta, 'vacaciones de verano')

        await page.goto(`/admin/empleados/${readId('empleado4')}`)
        await page.getByRole('tab', { name: 'Licencias' }).click()
        await page
          .getByRole('button', { name: 'Imprimir licencias y ausencias' })
          .click()
        const periodo = page.getByRole('dialog', {
          name: 'Licencias y ausencias',
          exact: true,
        })
        await expect(periodo).toBeVisible()
        await periodo.getByRole('button', { name: 'Ver hoja' }).click()

        const hoja = page.getByRole('dialog', {
          name: new RegExp(
            `^Licencias y ausencias - ${reNombreDe('empleado4').source}`,
          ),
        })
        await expect(hoja).toBeVisible()
        await expect(
          hoja.getByRole('heading', { name: 'Licencias', exact: true }),
        ).toBeVisible()

        await test.step('licencias: la licencia de la prueba con su motivo y 3 días', async () => {
          const fila = hoja
            .getByRole('row')
            .filter({ hasText: `${PREFIJO} vacaciones de verano` })
          await expect(fila).toHaveCount(1)
          await expect(fila).toContainText('3 días')
          await expect(
            hoja.getByText('Total de días de licencia en el período'),
          ).toBeVisible()
        })

        await test.step('ausencias a turnos: cliente, sede, motivo, con certificado y quién la cargó', async () => {
          await expect(
            hoja.getByRole('heading', { name: 'Ausencias a turnos' }),
          ).toBeVisible()
          const fila = hoja.getByRole('row').filter({ hasText: cliente.name })
          await expect(fila).toHaveCount(1)
          await expect(fila).toContainText(sede.name)
          await expect(fila).toContainText('14:00–18:00')
          await expect(fila).toContainText('Enfermedad')
          await expect(fila).toContainText('Con certificado')
          await expect(fila).toContainText('(administración)')
        })

        await test.step('si se corrige el certificado, la hoja nueva dice «Sin certificado»', async () => {
          await hoja
            .getByRole('button', { name: /Cerrar/ })
            .first()
            .click()
          await expect(hoja).toHaveCount(0)
          const corregido = await admin.rpc('set_absence_certificate', {
            p_assignment_id: asignacion,
            p_has_certificate: false,
          })
          expect(corregido.error, corregido.error?.message).toBeNull()
          await page.reload()
          await page.getByRole('tab', { name: 'Licencias' }).click()
          await page
            .getByRole('button', { name: 'Imprimir licencias y ausencias' })
            .click()
          await page.getByRole('button', { name: 'Ver hoja' }).click()
          const nueva = page.getByRole('dialog', {
            name: new RegExp(
              `^Licencias y ausencias - ${reNombreDe('empleado4').source}`,
            ),
          })
          await expect(
            nueva.getByRole('row').filter({ hasText: cliente.name }),
          ).toContainText('Sin certificado')
        })
      } finally {
        expect(await darDeBajaLicencias('empleado4'), 'bajas').toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
