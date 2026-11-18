import { expect, test } from '@playwright/test'
import { anioLejano } from '../../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { abrirCalendario, bloqueDe } from '../../fixtures/p30.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// P30.5 · OH-03 «Volver al lugar donde estaba»: el mes, la pestaña y los filtros viven en la dirección
// de la página (`?mes=`, `?pestana=`, `?q=`, `?estado=`) y los botones de salida regresan a la página
// anterior. DEF-P30-01: dos clics seguidos en «Mes siguiente» avanzan dos meses.
// Meses de un año lejano propio del conjunto de cuentas (no chocan con datos reales).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const ANIO = anioLejano()
const MES = `${ANIO}-07`
const DIA = `${MES}-10`

test.describe('volver conserva el mes, la pestaña y los filtros (OH-03)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'Planificación: el mes elegido está en la dirección; abrir un turno y cerrarlo vuelve al mismo mes',
    cubre('RB-A06', 'OH-03'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('nav')
        const sede = await sc.site(cliente.id, 'nav')
        const turno = await sc.shift(cliente.id, sede.id, DIA, {
          start: '08:00',
          end: '12:00',
        })
        await page.goto(`/admin/planificacion?vista=mes&mes=${MES}`)
        await expect(
          page.getByRole('button', { name: 'Elegir mes' }),
        ).toContainText(`julio ${ANIO}`)

        await page
          .getByRole('link', { name: new RegExp(`${sede.name}`) })
          .click()
        await expect(page).toHaveURL(new RegExp(`/admin/turnos/${turno}`))
        await page.keyboard.press('Escape')
        await expect(page).toHaveURL(
          new RegExp(`/admin/planificacion\\?.*mes=${MES}`),
        )
        await expect(
          page.getByRole('button', { name: 'Elegir mes' }),
        ).toContainText(`julio ${ANIO}`)
        await expect(
          page.getByRole('link', { name: new RegExp(`${sede.name}`) }),
        ).toBeVisible()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'dos clics seguidos en «Mes siguiente» avanzan dos meses y la dirección lo refleja (DEF-P30-01)',
    cubre('RB-A06', 'OH-03', 'DEF-P30-01'),
    async ({ page }) => {
      await page.goto(`/admin/planificacion?vista=mes&mes=${MES}`)
      await expect(
        page.getByRole('button', { name: 'Elegir mes' }),
      ).toContainText(`julio ${ANIO}`)
      await page.getByRole('button', { name: 'Mes siguiente' }).dblclick()
      await expect(
        page.getByRole('button', { name: 'Elegir mes' }),
      ).toContainText(`septiembre ${ANIO}`)
      await expect(page).toHaveURL(new RegExp(`mes=${ANIO}-09`))
      // El navegador «atrás» no recorre cada mes visitado (se usa `replace`).
      await page.getByRole('button', { name: 'Mes anterior' }).click()
      await expect(page).toHaveURL(new RegExp(`mes=${ANIO}-08`))
    },
  )

  test(
    'ficha del empleado: la pestaña «Calendario» y el mes están en la dirección; abrir un turno y cerrarlo vuelve al mismo mes',
    cubre('RB-A05', 'OH-03', 'OH-04'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('navf')
        const sede = await sc.site(cliente.id, 'navf')
        const turno = await sc.shift(cliente.id, sede.id, DIA, {
          start: '08:00',
          end: '12:00',
        })
        await sc.assign(turno, 'empleado4')
        await abrirCalendario(page, 'empleado4', DIA)
        await expect(page).toHaveURL(/pestana=calendario/)
        await expect(page).toHaveURL(new RegExp(`mes=${MES}`))

        await bloqueDe(page, sede.name)
          .getByRole('button', { name: /^Abrir el turno de / })
          .click()
        await expect(page).toHaveURL(new RegExp(`/admin/turnos/${turno}`))
        await page.keyboard.press('Escape')
        await expect(page).toHaveURL(/pestana=calendario/)
        await expect(page).toHaveURL(new RegExp(`mes=${MES}`))
        await expect(page.getByTestId(`dia-${DIA}`)).toBeVisible()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'Clientes: el texto buscado y el estado viven en la dirección y vuelven al regresar de la ficha',
    cubre('RB-A02', 'OH-03'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('navc')
        await page.goto('/admin/clientes?estado=all')
        const buscador = page.getByPlaceholder('Buscar por nombre o CUIT…')
        await buscador.fill(cliente.name)
        await expect(page).toHaveURL(/q=/)
        await page.getByRole('link', { name: cliente.name }).first().click()
        await expect(page).toHaveURL(
          new RegExp(`/admin/clientes/${cliente.id}`),
        )
        await page.goBack()
        await expect(page).toHaveURL(/q=/)
        await expect(page).toHaveURL(/estado=all/)
        await expect(buscador).toHaveValue(cliente.name)
        await expect(
          page.getByRole('link', { name: cliente.name }).first(),
        ).toBeVisible()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
