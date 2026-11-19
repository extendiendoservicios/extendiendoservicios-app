import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import {
  daysFromToday,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
  FRANJAS,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { asignadosDe, limpiarPersona } from '../../fixtures/p30.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P30.5 · OH-08 «Las licencias liberan los turnos» (`save_employee_leave`, 0087). Pestaña
// «Licencias» de la ficha, escritorio 1280 px: la vista previa dice cuántos turnos se liberan
// ANTES de guardar, «Cancelar» no toca nada, «Confirmar» guarda la licencia y libera en una sola
// transacción, la lista de turnos sin cubrir ofrece «Reemplazar», los turnos con fichaje no se
// tocan y ampliar una licencia libera los turnos que entran en el nuevo período.
// Cuenta de este archivo: empleado5. Las licencias de la prueba llevan el motivo `e2e-...`.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const MOTIVO = 'e2e-p30 licencia'

async function abrirLicencias(page: Page) {
  await page.goto(`/admin/empleados/${readId('empleado5')}`)
  await page.getByRole('tab', { name: 'Licencias' }).click()
  await expect(page.getByLabel('Desde')).toBeVisible()
}

async function cargarFormulario(page: Page, desde: string, hasta: string) {
  await page.getByLabel('Desde').fill(desde)
  await page.getByLabel('Hasta (opcional)').fill(hasta)
  await page.getByLabel('Motivo (opcional)').fill(MOTIVO)
  await page.getByRole('button', { name: 'Agregar licencia' }).click()
}

async function licenciasDe(sc: Scenario) {
  const { data } = await sc.db
    .from('employee_leaves')
    .select('id, starts_on, ends_on, reason, deleted_at')
    .eq('employee_id', readId('empleado5'))
    .like('reason', 'e2e-%')
    .is('deleted_at', null)
  return data ?? []
}

test.describe('licencias que liberan los turnos (OH-08)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'la vista previa lista los turnos, «Cancelar» no guarda nada y «Confirmar» guarda y libera solo los del período; ofrece «Reemplazar»',
    cubre('RB-A03', 'RB-A04', 'OH-08', 'CB-02'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('lic')
        const sede = await sc.site(cliente.id, 'lic')
        const d1 = daysFromToday(40)
        const d2 = daysFromToday(41)
        const fuera = daysFromToday(60)
        const t1 = await sc.shift(cliente.id, sede.id, d1, FRANJAS.manana)
        const t2 = await sc.shift(cliente.id, sede.id, d2, FRANJAS.tarde)
        const t3 = await sc.shift(cliente.id, sede.id, fuera, FRANJAS.manana)
        for (const t of [t1, t2, t3]) await sc.assign(t, 'empleado5')

        await abrirLicencias(page)
        await cargarFormulario(page, d1, d2)

        const dialogo = page.getByRole('dialog')
        await test.step('vista previa: «Se van a liberar 2 turnos de <nombre>» y la lista; todavía no se tocó nada', async () => {
          await expect(
            dialogo.getByRole('heading', {
              name: `Se van a liberar 2 turnos de ${nombreDe('empleado5')}`,
            }),
          ).toBeVisible()
          await expect(dialogo.getByRole('listitem')).toHaveCount(2)
          await expect(dialogo).toContainText(sede.name)
          expect(await licenciasDe(sc), 'sin licencia todavía').toHaveLength(0)
          expect((await asignadosDe(sc, t1)).length).toBe(1)
        })

        await test.step('«Cancelar» no guarda la licencia ni libera', async () => {
          await dialogo.getByRole('button', { name: 'Cancelar' }).click()
          await expect(dialogo).toBeHidden()
          expect(await licenciasDe(sc)).toHaveLength(0)
          expect((await asignadosDe(sc, t1)).length).toBe(1)
          expect((await asignadosDe(sc, t2)).length).toBe(1)
        })

        await test.step('«Confirmar» guarda la licencia y libera los dos turnos del período, no el de afuera', async () => {
          await page.getByRole('button', { name: 'Agregar licencia' }).click()
          await expect(
            dialogo.getByRole('heading', {
              name: /^Se van a liberar 2 turnos/,
            }),
          ).toBeVisible()
          await dialogo.getByRole('button', { name: 'Confirmar' }).click()
          await expect(page.getByText('Agregamos la licencia.')).toBeVisible()
          await expect(
            page.getByText(/^Quedaron 2 turnos sin cubrir por la licencia de /),
          ).toBeVisible()
          expect(await licenciasDe(sc)).toHaveLength(1)
          expect(await asignadosDe(sc, t1)).toEqual([])
          expect(await asignadosDe(sc, t2)).toEqual([])
          expect(await asignadosDe(sc, t3)).toEqual([readId('empleado5')])
          // Misma baja lógica que «Quitar»: queda el motivo «Licencia (…)» en las asignaciones.
          const { data } = await sc.db
            .from('assignments')
            .select('removed_reason, removed_by')
            .eq('shift_id', t1)
            .not('removed_at', 'is', null)
          expect(data?.[0]?.removed_reason).toMatch(/^Licencia \(/)
          expect(data?.[0]?.removed_by).not.toBeNull()
          // El turno vuelve a quedar sin cubrir.
          const { data: turno } = await sc.db
            .from('shifts')
            .select('status')
            .eq('id', t1)
            .single()
          expect(turno?.status).toBe('scheduled')
        })

        await test.step('cada turno sin cubrir ofrece «Reemplazar» (abre la asignación) y «Ver turno»', async () => {
          const fila = page
            .getByRole('listitem')
            .filter({ hasText: sede.name })
            .first()
          await expect(
            fila.getByRole('button', { name: /^Reemplazar en / }),
          ).toBeVisible()
          await expect(
            fila.getByRole('button', { name: 'Ver turno' }),
          ).toBeVisible()
          await fila.getByRole('button', { name: /^Reemplazar en / }).click()
          await expect(
            page.getByRole('dialog').filter({ hasText: /Asignar|Reemplaz/ }),
          ).toBeVisible()
        })
        await page.keyboard.press('Escape')
        await expectNoHorizontalScroll(page)
      } finally {
        expect(
          await limpiarPersona(sc, 'empleado5'),
          'limpieza persona',
        ).toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'sin turnos en el período la licencia se guarda directo, sin diálogo; ampliarla hacia un turno pide confirmar y lo libera',
    cubre('RB-A03', 'OH-08'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('licamp')
        const sede = await sc.site(cliente.id, 'licamp')
        const d0 = daysFromToday(50)
        const dTurno = daysFromToday(52)
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          dTurno,
          FRANJAS.manana,
        )
        await sc.assign(turno, 'empleado5')

        await abrirLicencias(page)
        await cargarFormulario(page, d0, d0)
        await expect(page.getByText('Agregamos la licencia.')).toBeVisible()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        expect(await licenciasDe(sc)).toHaveLength(1)
        expect(await asignadosDe(sc, turno)).toHaveLength(1)

        await test.step('ampliar el «hasta» hasta el día del turno: vista previa y liberación', async () => {
          await page
            .getByRole('button', { name: /^Editar la licencia del / })
            .first()
            .click()
          await page.getByLabel('Hasta (opcional)').fill(dTurno)
          await page.getByRole('button', { name: 'Guardar cambios' }).click()
          const dialogo = page.getByRole('dialog')
          await expect(
            dialogo.getByRole('heading', {
              name: `Se va a liberar 1 turno de ${nombreDe('empleado5')}`,
            }),
          ).toBeVisible()
          await dialogo.getByRole('button', { name: 'Confirmar' }).click()
          await expect(
            page.getByText('Guardamos los cambios de la licencia.'),
          ).toBeVisible()
          expect(await asignadosDe(sc, turno)).toEqual([])
          const licencias = await licenciasDe(sc)
          expect(licencias).toHaveLength(1)
          expect(licencias[0]?.ends_on).toBe(dTurno)
        })
      } finally {
        expect(
          await limpiarPersona(sc, 'empleado5'),
          'limpieza persona',
        ).toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'un turno con fichaje no se toca: la vista previa lo avisa («no se toca») y la asignación sigue',
    cubre('RB-A03', 'RB-A08', 'OH-08', 'CB-05'),
    async ({ page }) => {
      test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('licfich')
        const sede = await sc.site(cliente.id, 'licfich')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const asignacion = await sc.assign(turno, 'empleado5')
        const empleado = await sessionClient('empleado5')
        const inicio = await empleado.rpc('record_check_in', {
          p_assignment_id: asignacion,
        })
        expect(inicio.error, inicio.error?.message).toBeNull()

        await abrirLicencias(page)
        await cargarFormulario(page, sc.today, daysFromToday(1))
        const dialogo = page.getByRole('dialog')
        await expect(
          dialogo.getByRole('heading', {
            name: 'Revisá los turnos de esta licencia',
          }),
        ).toBeVisible()
        await expect(dialogo).toContainText(
          'Este turno tiene fichajes y no se toca',
        )
        await dialogo.getByRole('button', { name: 'Confirmar' }).click()
        await expect(page.getByText('Agregamos la licencia.')).toBeVisible()
        // No quedó ningún turno sin cubrir y la asignación con fichaje sigue vigente.
        await expect(
          page.getByText(/turnos? sin cubrir por la licencia/),
        ).toHaveCount(0)
        expect(await asignadosDe(sc, turno)).toEqual([readId('empleado5')])
        expect(await licenciasDe(sc)).toHaveLength(1)
      } finally {
        expect(
          await limpiarPersona(sc, 'empleado5'),
          'limpieza persona',
        ).toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
