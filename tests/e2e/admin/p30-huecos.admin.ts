import { expect, test } from '@playwright/test'
import { addDays } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { abrirCalendario, asignadosDe, fechaDeMes } from '../../fixtures/p30.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P30.5 · OH-06 «Fijos que no quedaron asignados» (`employee_fixed_gaps`, 0087): en el calendario
// mensual de la ficha, el día en que la persona es fija de un servicio con turno y no está asignada
// muestra un bloque con borde punteado, el motivo y los botones «Reemplazar» / «Asignar».
// Motivos probados: ADDED_AFTER («Fijo agregado después de generar»), ON_LEAVE («De licencia») y
// OVERLAP («Se superpone con …», con enlace al turno). Cuenta de este archivo: empleado1.
// Fechas en un mes futuro (días 3 a 24) para no depender del día en que corre.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const BASE = fechaDeMes(14)
const dia = (n: number) => addDays(BASE, n)

/** Servicio activo todos los días con un turno el `fecha` y empleado1 como fijo, DESPUÉS de crear el turno. */
async function servicioConFijo(
  sc: Scenario,
  slug: string,
  fecha: string,
  franja = { start: '08:00', end: '10:00' },
  siteName?: string,
) {
  const cliente = await sc.client(slug)
  const sede = await sc.site(cliente.id, siteName ?? slug)
  const servicio = await sc.service(cliente.id, sede.id, slug, {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    start: franja.start,
    end: franja.end,
  })
  const turno = await sc.shift(cliente.id, sede.id, fecha, franja, 1, {
    serviceId: servicio.id,
  })
  return { cliente, sede, servicio, turno }
}

async function agregarFijo(sc: Scenario, servicio: string) {
  const { error } = await sc.db
    .from('service_fixed_employees')
    .insert({ service_id: servicio, employee_id: readId('empleado1') })
  expect(error, error?.message).toBeNull()
}

async function limpiar(sc: Scenario) {
  await sc.db
    .from('service_fixed_employees')
    .delete()
    .in('service_id', sc.extraServiceIds)
  expect(await sc.cleanup(), 'limpieza').toEqual([])
}

test.describe('fijos sin asignar en el calendario del empleado (OH-06)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    '«Fijo agregado después de generar»: el bloque punteado ofrece «Asignar», que asigna y lo convierte en un turno',
    cubre('RB-A04', 'RB-A05', 'OH-06', 'CB-02'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const { sede, servicio, turno } = await servicioConFijo(
          sc,
          'hueco-a',
          dia(1),
        )
        // El fijo se agrega DESPUÉS de crear el turno: la persona no quedó asignada.
        await agregarFijo(sc, servicio.id)

        await abrirCalendario(page, 'empleado1', dia(1))
        const celda = page.getByTestId(`dia-${dia(1)}`)
        const hueco = celda.getByTestId('hueco')
        await expect(hueco).toHaveCount(1)
        await expect(hueco).toHaveAttribute('data-reason', 'ADDED_AFTER')
        await expect(hueco).toContainText(sede.name.toUpperCase())
        await expect(hueco.getByTestId('hueco-motivo')).toHaveText(
          'Fijo agregado después de generar',
        )
        await expect(hueco).toHaveCSS('border-top-style', 'dashed')
        await expect(
          hueco.getByRole('button', { name: /^Reemplazar a / }),
        ).toBeVisible()

        await hueco.getByRole('button', { name: /^Asignar a / }).click()
        await expect(
          page.getByText(/^Asignamos a .* al turno de /),
        ).toBeVisible()
        await expect
          .poll(async () => (await asignadosDe(sc, turno)).length)
          .toBe(1)
        await expect(celda.getByTestId('hueco')).toHaveCount(0)
        await expect(celda.getByTestId('turno')).toBeVisible()
        await expectNoHorizontalScroll(page)
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    '«De licencia»: sobre el día de licencia aparece el turno que hay que cubrir con «Reemplazar» y sin «Asignar»',
    cubre('RB-A03', 'RB-A04', 'OH-06'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const { sede, servicio } = await servicioConFijo(sc, 'hueco-l', dia(2))
        await agregarFijo(sc, servicio.id)
        await sc.leave('empleado1', dia(2), dia(2))

        await abrirCalendario(page, 'empleado1', dia(2))
        const celda = page.getByTestId(`dia-${dia(2)}`)
        await expect(celda).toHaveAttribute('data-kind', 'leave')
        const hueco = celda.getByTestId('hueco')
        await expect(hueco).toHaveCount(1)
        await expect(hueco).toHaveAttribute('data-reason', 'ON_LEAVE')
        await expect(hueco).toContainText(sede.name.toUpperCase())
        await expect(hueco.getByTestId('hueco-motivo')).toHaveText(
          'De licencia',
        )
        await expect(
          hueco.getByRole('button', { name: /^Asignar a / }),
        ).toHaveCount(0)

        // «Reemplazar» abre la asignación del turno con los disponibles (sin esta persona).
        await hueco.getByRole('button', { name: /^Reemplazar a / }).click()
        await expect(
          page
            .getByRole('dialog')
            .filter({ has: page.getByText(/Asignar|Reemplaz|disponibles/i) }),
        ).toBeVisible()
      } finally {
        await limpiar(sc)
      }
    },
  )

  test(
    '«Se superpone con …»: el motivo nombra el otro turno de la persona y enlaza a él',
    cubre('RB-A04', 'OH-06', 'CB-10'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        // Turno del servicio 08:00–10:00 (sede A) y otro turno de la persona 09:00–11:00 (sede B).
        const { servicio } = await servicioConFijo(sc, 'hueco-o', dia(3), {
          start: '08:00',
          end: '10:00',
        })
        const otroCliente = await sc.client('hueco-ob')
        const otraSede = await sc.site(otroCliente.id, 'hueco-ob')
        const otroTurno = await sc.shift(otroCliente.id, otraSede.id, dia(3), {
          start: '09:00',
          end: '11:00',
        })
        await sc.assign(otroTurno, 'empleado1')
        await agregarFijo(sc, servicio.id)

        await abrirCalendario(page, 'empleado1', dia(3))
        const hueco = page.getByTestId(`dia-${dia(3)}`).getByTestId('hueco')
        await expect(hueco).toHaveCount(1)
        await expect(hueco).toHaveAttribute('data-reason', 'OVERLAP')
        const motivo = hueco.getByTestId('hueco-motivo')
        await expect(motivo).toContainText('Se superpone con')
        await expect(motivo).toContainText(otraSede.name)
        await expect(motivo).toContainText('09:00–11:00')
        await motivo.getByRole('link').click()
        await expect(page).toHaveURL(new RegExp(`/admin/turnos/${otroTurno}`))
      } finally {
        await limpiar(sc)
      }
    },
  )
})

test.describe('quién ve los fijos sin asignar (OH-06)', () => {
  test.use({ storageState: storageStatePath('supervisor1') })
  test(
    '[supervisor1] el coordinador no ve bloques de fijos sin asignar',
    cubre('RB-X02', 'CB-17', 'OH-06'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const { servicio } = await servicioConFijo(sc, 'hueco-s', dia(2))
        await agregarFijo(sc, servicio.id)
        await abrirCalendario(page, 'empleado1', dia(2)).catch(() => undefined)
        await expect(page.getByRole('main')).toBeVisible()
        await expect(page.getByTestId('hueco')).toHaveCount(0)
      } finally {
        await limpiar(sc)
      }
    },
  )
})
