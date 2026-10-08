import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../fixtures/accounts.ts'
import { daysFromToday } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import { elegirFecha, partesDe } from './helpers/fechas.ts'
import { cargarJornada, cargarSupervision } from './helpers/historial.ts'

// P19.5d · AJ-06 (módulo F, P-102): pestaña Asistencia de la ficha.
//   - Columna «Horas trabajadas» por turno, con el mismo indicador que «Servicios de hoy».
//   - «Total del período» que cambia con Desde–Hasta.
//   - «Descargar detalle» (dueño y administrador): vista previa con membrete (logo), tabla, total y
//     dos firmas; se imprime con `window.print` (acá reemplazado por un contador: no se imprime).
//   - Supervisor con doble rol: columna «Tipo» con las supervisiones sumadas al mismo total.
// Fechas pasadas (ayer y anteriores) con horas fijas: el resultado no depende de la hora de la
// corrida. Cuentas: empleado1 (solo empleado) y dual (empleado y supervisor).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

declare global {
  interface Window {
    __impresiones?: number
  }
}

/** Reemplaza `window.print` por un contador: la prueba nunca abre el diálogo de impresión. */
async function interceptarImpresion(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__impresiones = 0
    window.print = () => {
      window.__impresiones = (window.__impresiones ?? 0) + 1
    }
  })
}

const FRANJA = { start: '08:00', end: '11:00' }

for (const quien of ['owner', 'admin'] as const) {
  test.describe(`Asistencia de la ficha vista por ${quien === 'owner' ? 'el dueño' : 'un administrador'}`, () => {
    test.use({ storageState: storageStatePath(quien) })

    test(
      'horas por turno, total del período con Desde–Hasta y hoja imprimible con membrete, tabla, total y dos firmas',
      cubre('RB-A06', 'RB-A08', 'P-102'),
      async ({ page }) => {
        test.setTimeout(180_000)
        await interceptarImpresion(page)
        const ayer = daysFromToday(-1)
        const anteayer = daysFromToday(-2)
        const sc = new Scenario()
        try {
          const cliente = await sc.client('ficha')
          const sede = await sc.site(cliente.id, 'ficha')
          // Ayer: cumplió las 3 h (180 min). Anteayer: se fue 30 min antes (150 min).
          await cargarJornada(sc, {
            cliente,
            sede,
            fecha: ayer,
            franja: FRANJA,
            quien: 'empleado1',
            entrada: '08:00',
            salida: '11:00',
          })
          await cargarJornada(sc, {
            cliente,
            sede,
            fecha: anteayer,
            franja: FRANJA,
            quien: 'empleado1',
            entrada: '08:00',
            salida: '10:30',
          })

          await page.goto(`/admin/empleados/${readId('empleado1')}`)
          await page.getByRole('tab', { name: 'Asistencia' }).click()
          const total = page.getByLabel('Total de horas del período')

          await test.step('columna «Horas trabajadas», con tilde y con advertencia', async () => {
            const tabla = page.getByRole('table', {
              name: 'Historial de asistencia',
            })
            await expect(
              tabla.getByRole('columnheader', { name: 'Horas trabajadas' }),
            ).toBeVisible()
            // Quien es solo empleado no ve la columna «Tipo».
            await expect(
              tabla.getByRole('columnheader', { name: 'Tipo' }),
            ).toHaveCount(0)
            const cumple = tabla
              .getByRole('row')
              .filter({ hasText: sede.name })
              .filter({ hasText: '08:00–11:00' })
            await expect(cumple).toHaveCount(2)
            await expect(tabla.locator('svg.text-success')).toHaveCount(1)
            await expect(
              tabla.locator('[title="Salida anticipada · faltan 30 min"]'),
            ).toHaveCount(1)
          })

          await test.step('el total del período suma los dos turnos y cambia al mover Desde y Hasta', async () => {
            await expect(total).toContainText('5 h 30 min')
            // Hasta anteayer: queda solo el turno de anteayer (2 h 30 min).
            await elegirFecha(page, 'Hasta', partesDe(anteayer))
            await expect(total).toContainText('2 h 30 min')
            // Vuelve a hoy y mueve Desde a ayer: queda solo el turno de ayer (3 h).
            await elegirFecha(page, 'Hasta', partesDe(daysFromToday(0)))
            await expect(total).toContainText('5 h 30 min')
            await elegirFecha(page, 'Desde', partesDe(ayer))
            await expect(total).toContainText(/^Total del período\s*3 h$/)
          })

          await test.step('«Descargar detalle»: vista previa con logo, tabla, total y dos firmas', async () => {
            // Rango completo otra vez para que entren los dos turnos.
            await elegirFecha(page, 'Desde', partesDe(anteayer))
            await expect(total).toContainText('5 h 30 min')
            await page
              .getByRole('button', { name: 'Descargar detalle' })
              .click()
            const hoja = page.getByRole('dialog', {
              name: new RegExp(
                `^Detalle de asistencia - ${nombreDe('empleado1')} - `,
              ),
            })
            await expect(hoja).toBeVisible()
            // Membrete: logo cargado (naturalWidth > 0), nombre de la empresa y fecha de emisión.
            const logo = hoja.getByRole('img').first()
            await expect(logo).toBeVisible()
            await expect
              .poll(() =>
                logo.evaluate((img) => (img as HTMLImageElement).naturalWidth),
              )
              .toBeGreaterThan(0)
            await expect(
              hoja.getByRole('heading', { name: 'Detalle de asistencia' }),
            ).toBeVisible()
            await expect(hoja.getByText(/^Emitido el /)).toBeVisible()
            // Datos de la persona y del período.
            await expect(hoja.getByText('Persona:')).toBeVisible()
            await expect(hoja.getByText(nombreDe('empleado1'))).toBeVisible()
            await expect(hoja.getByText('Período:')).toBeVisible()
            // Tabla: encabezados, dos filas en orden cronológico (anteayer y ayer) y el total.
            for (const encabezado of [
              'Fecha',
              'Cliente',
              'Sede',
              'Franja',
              'Inicio',
              'Fin',
              'Horas',
            ]) {
              await expect(
                hoja.getByRole('columnheader', {
                  name: encabezado,
                  exact: true,
                }),
              ).toBeVisible()
            }
            await expect(
              hoja.getByRole('columnheader', { name: 'Tipo' }),
            ).toHaveCount(0)
            const filas = hoja
              .getByRole('row')
              .filter({ has: page.locator('td') })
              .filter({ hasText: sede.name })
            await expect(filas).toHaveCount(2)
            await expect(filas.first()).toContainText('2 h 30 min')
            await expect(filas.last()).toContainText('3 h')
            await expect(
              hoja.getByRole('row', { name: /Total del período/ }),
            ).toContainText('5 h 30 min')
            // Dos firmas con aclaración.
            await expect(
              hoja.getByText('Responsable (administración)'),
            ).toBeVisible()
            await expect(
              hoja.getByRole('paragraph').filter({ hasText: /^Empleado$/ }),
            ).toBeVisible()
            await expect(hoja.getByText('Firma', { exact: true })).toHaveCount(
              2,
            )
            await expect(
              hoja.getByText('Aclaración', { exact: true }),
            ).toHaveCount(2)

            // Imprimir llama a window.print (reemplazado) y Cerrar vuelve a la ficha.
            await hoja
              .getByRole('button', { name: 'Imprimir o guardar como PDF' })
              .click()
            expect(await page.evaluate(() => window.__impresiones)).toBe(1)

            // Con los estilos de impresión: solo queda la hoja (sin la app ni la barra de botones)
            // y entra en una sola página A4 (dos filas). No se imprime nada: se emula el medio.
            await page.emulateMedia({ media: 'print' })
            await expect(page.locator('#root')).toBeHidden()
            await expect(
              hoja.getByRole('button', { name: 'Imprimir o guardar como PDF' }),
            ).toBeHidden()
            await expect(
              hoja.getByRole('row', { name: /Total del período/ }),
            ).toBeVisible()
            const pdf = await page.pdf({
              format: 'A4',
              preferCSSPageSize: true,
            })
            const paginas = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)
            expect(paginas, 'la hoja entra en una página A4').toHaveLength(1)
            await page.emulateMedia({ media: 'screen' })

            await hoja.getByRole('button', { name: 'Cerrar' }).click()
            await expect(hoja).toHaveCount(0)
            await page
              .getByRole('button', { name: 'Descargar detalle' })
              .click()
            await page.keyboard.press('Escape')
            await expect(hoja).toHaveCount(0)
          })
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })
}

test.describe('Supervisor con doble rol en la ficha', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'muestra la columna «Tipo» con servicios y supervisiones, y las horas de las dos suman al total y a la hoja',
    cubre('RB-A06', 'RB-S01', 'P-102', 'CB-13'),
    async ({ page }) => {
      test.setTimeout(180_000)
      await interceptarImpresion(page)
      const ayer = daysFromToday(-1)
      const anteayer = daysFromToday(-2)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('ficha-dual')
        const sedeServicio = await sc.site(cliente.id, 'ficha-dual-servicio')
        const sedeSupervision = await sc.site(cliente.id, 'ficha-dual-sup')
        // Ayer trabaja como empleado 3 h; anteayer supervisa 2 h (de 09:00 a 11:00).
        await cargarJornada(sc, {
          cliente,
          sede: sedeServicio,
          fecha: ayer,
          franja: FRANJA,
          quien: 'dual',
          entrada: '08:00',
          salida: '11:00',
        })
        await cargarSupervision(sc, {
          cliente,
          sede: sedeSupervision,
          fecha: anteayer,
          franja: FRANJA,
          quien: 'dual',
          entrada: '09:00',
          salida: '11:00',
        })

        await page.goto(`/admin/empleados/${readId('dual')}`)
        await page.getByRole('tab', { name: 'Asistencia' }).click()
        const tabla = page.getByRole('table', {
          name: 'Historial de asistencia',
        })
        await expect(
          tabla.getByRole('columnheader', { name: 'Tipo' }),
        ).toBeVisible()
        const servicio = tabla
          .getByRole('row')
          .filter({ hasText: sedeServicio.name })
        await expect(servicio).toContainText('Servicio')
        await expect(servicio).toContainText('3 h')
        const supervision = tabla
          .getByRole('row')
          .filter({ hasText: sedeSupervision.name })
        await expect(supervision).toContainText('Supervisión')
        await expect(supervision).toContainText('2 h')
        // 3 h de servicio + 2 h de supervisión.
        await expect(
          page.getByLabel('Total de horas del período'),
        ).toContainText('5 h')

        await page.getByRole('button', { name: 'Descargar detalle' }).click()
        const hoja = page.getByRole('dialog', {
          name: new RegExp(`^Detalle de asistencia - ${nombreDe('dual')} - `),
        })
        await expect(hoja).toBeVisible()
        await expect(
          hoja.getByRole('columnheader', { name: 'Tipo' }),
        ).toBeVisible()
        await expect(
          hoja.getByRole('row').filter({ hasText: 'Supervisión' }),
        ).toHaveCount(1)
        await expect(
          hoja.getByRole('row', { name: /Total del período/ }),
        ).toContainText('5 h')
        await expect(
          hoja.getByText(/^(Empleado y supervisor|Supervisor y empleado)$/),
        ).toBeVisible()
        await expect(hoja.getByText('Firma', { exact: true })).toHaveCount(2)
        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('Asistencia de la ficha en el celular (390 px)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'la pestaña Asistencia y la hoja imprimible no desbordan a 390 px',
    cubre('RB-A06', 'RB-X05', 'P-102'),
    async ({ page }) => {
      const ayer = daysFromToday(-1)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('ficha-390')
        const sede = await sc.site(cliente.id, 'ficha-390')
        await cargarJornada(sc, {
          cliente,
          sede,
          fecha: ayer,
          franja: FRANJA,
          quien: 'empleado3',
          entrada: '08:00',
          salida: '10:15',
        })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(`/admin/empleados/${readId('empleado3')}`)
        await page.getByRole('tab', { name: 'Asistencia' }).click()
        await expect(
          page.getByLabel('Total de horas del período'),
        ).toContainText('2 h 15 min')
        await expect(
          page.getByRole('button', { name: 'Descargar detalle' }),
        ).toBeVisible()
        await expect(page.getByText(sede.name).first()).toBeVisible()
        await expectNoHorizontalScroll(page)

        await page.getByRole('button', { name: 'Descargar detalle' }).click()
        const hoja = page.getByRole('dialog', {
          name: new RegExp(
            `^Detalle de asistencia - ${nombreDe('empleado3')} - `,
          ),
        })
        await expect(hoja).toBeVisible()
        await expect(
          hoja.getByRole('row', { name: /Total del período/ }),
        ).toContainText('2 h 15 min')
        // La hoja tiene su propio scroll interno; la página de atrás no se desborda.
        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
