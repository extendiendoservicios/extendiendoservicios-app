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
import {
  agregarFilasDeRelleno,
  expectColumnasCortasEnUnRenglon,
  expectFirmasSinCruzar,
  expectHojaA4,
  expectHojaEntraEnPantalla,
  medirHoja,
} from './helpers/hoja.ts'

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
            await expect(hoja.getByText('Nombre y Apellido:')).toBeVisible()
            await expect(hoja.getByText('Persona:')).toHaveCount(0)
            await expect(hoja.getByText(nombreDe('empleado1'))).toBeVisible()
            await expect(hoja.getByText('Rol:')).toBeVisible()
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
            // Sin licencias en el período: ni dato «Licencias:» ni filas de licencia; la
            // conformidad nombra las horas, las licencias y las inasistencias.
            await expect(hoja.getByText('Licencias:')).toHaveCount(0)
            await expect(
              hoja.getByText(
                'Las partes prestan conformidad con el detalle de horas, licencias e inasistencias consignado.',
              ),
            ).toBeVisible()

            // Medidas de la hoja A4 (P19.12a): 210 mm, alto múltiplo de 297 mm, firmas enteras
            // dentro de una página y columnas cortas de un solo renglón.
            await expect(page.getByTestId('print-sheet')).toBeVisible()
            const medida = await medirHoja(page)
            expectHojaA4(medida)
            expect(medida.escala, 'a 1280 px la hoja no se achica').toBe(1)
            expectFirmasSinCruzar(medida)
            expectColumnasCortasEnUnRenglon(medida)

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
          hoja.getByText(/^(Empleado y coordinador|Coordinador y empleado)$/),
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
        // La hoja sigue siendo A4 (210 mm) pero se achica para entrar entera en los 390 px, sin
        // scroll horizontal (P19.12a).
        await expect(page.getByTestId('print-sheet')).toBeVisible()
        await expect
          .poll(async () => (await medirHoja(page)).escala, {
            message: 'la vista previa se achica a 390 px',
          })
          .toBeLessThan(1)
        const medida = await medirHoja(page)
        expectHojaA4(medida)
        expectHojaEntraEnPantalla(medida)
        expectFirmasSinCruzar(medida)
        expectColumnasCortasEnUnRenglon(medida)
        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('Licencias en el detalle de asistencia (P19.12a)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'una licencia aparece como fila en su fecha entre los turnos, no cambia el total de horas y la hoja la nombra',
    cubre('RB-A06', 'RB-A04', 'P-102', 'P-033'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await interceptarImpresion(page)
      const hace4 = daysFromToday(-4)
      const hace3 = daysFromToday(-3)
      const hace2 = daysFromToday(-2)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('ficha-licencia')
        const sede = await sc.site(cliente.id, 'ficha-licencia')
        // Turnos de 3 h hace 4 y hace 2 días; la licencia de un día cae en el medio.
        for (const fecha of [hace4, hace2]) {
          await cargarJornada(sc, {
            cliente,
            sede,
            fecha,
            franja: FRANJA,
            quien: 'empleado2',
            entrada: '08:00',
            salida: '11:00',
          })
        }

        await page.goto(`/admin/empleados/${readId('empleado2')}`)
        await page.getByRole('tab', { name: 'Asistencia' }).click()
        const total = page.getByLabel('Total de horas del período')
        await expect(total).toContainText('6 h')

        // Sin licencia: la hoja no trae el dato «Licencias:» ni fila de licencia.
        await page.getByRole('button', { name: 'Descargar detalle' }).click()
        const hoja = page.getByRole('dialog', {
          name: new RegExp(
            `^Detalle de asistencia - ${nombreDe('empleado2')} - `,
          ),
        })
        await expect(hoja).toBeVisible()
        await expect(hoja.getByText('Licencias:')).toHaveCount(0)
        await expect(hoja.getByText(/Licencia del /)).toHaveCount(0)
        await page.keyboard.press('Escape')
        await expect(hoja).toHaveCount(0)

        // Se carga la licencia de un día (hace 3 días) y se recarga la ficha.
        await sc.leave('empleado2', hace3, hace3)
        await page.reload()
        await page.getByRole('tab', { name: 'Asistencia' }).click()
        // El total de horas no cambia: la licencia no suma ni resta horas.
        await expect(total).toContainText('6 h')
        await expect(total).not.toContainText('min')

        await page.getByRole('button', { name: 'Descargar detalle' }).click()
        await expect(hoja).toBeVisible()
        await expect(hoja.getByText('Licencias:')).toBeVisible()
        await expect(
          hoja.getByText('Licencias:').locator('xpath=..'),
        ).toContainText('1')
        const dd = (iso: string) => {
          const [a, m, d] = iso.split('-')
          return `${d}/${m}/${a}`
        }
        // En la tabla la fecha va como «17 oct 2026» (día sin cero, mes abreviado, año).
        const fechaCorta = (iso: string) => {
          const [a, , d] = iso.split('-')
          return new RegExp(`^${Number(d)} [a-zñ]+[.]? ${a}$`, 'u')
        }
        const filaLicencia = hoja
          .getByRole('row')
          .filter({ hasText: 'Licencia del ' })
        await expect(filaLicencia).toHaveCount(1)
        await expect(filaLicencia).toContainText(
          `Licencia del ${dd(hace3)} al ${dd(hace3)} — e2e-licencia`,
        )
        // Celda unida: una sola celda de Cliente a Observaciones, con el texto de la licencia.
        const celdaUnida = filaLicencia.getByRole('cell', {
          name: /^Licencia del /,
        })
        await expect(celdaUnida).toHaveCount(1)
        const colspan = Number(await celdaUnida.getAttribute('colspan'))
        expect(colspan, 'colspan de la celda unida').toBeGreaterThanOrEqual(4)
        await expect(filaLicencia.getByRole('cell').first()).toHaveText(
          fechaCorta(hace3),
        )
        await expect(filaLicencia.getByRole('cell').last()).toHaveText('—')

        // Orden cronológico: turno de hace 4 días, licencia, turno de hace 2 días.
        const filas = hoja.getByRole('row').filter({ has: page.locator('td') })
        const textos = await filas.allInnerTexts()
        const posicion = (patron: RegExp) =>
          textos.findIndex((texto) => patron.test(texto))
        const iTurno4 = posicion(
          new RegExp(fechaCorta(hace4).source.replace('$', ''), 'u'),
        )
        const iLicencia = posicion(/Licencia del /)
        const iTurno2 = posicion(
          new RegExp(fechaCorta(hace2).source.replace('$', ''), 'u'),
        )
        expect(iTurno4, 'turno de hace 4 días').toBeGreaterThanOrEqual(0)
        expect(iLicencia, 'fila de licencia').toBeGreaterThan(iTurno4)
        expect(iTurno2, 'turno de hace 2 días').toBeGreaterThan(iLicencia)
        // El total de la hoja sigue siendo el de los dos turnos.
        await expect(
          hoja.getByRole('row', { name: /Total del período/ }),
        ).toContainText('6 h')
        await expect(
          hoja.getByText(
            'Las partes prestan conformidad con el detalle de horas, licencias e inasistencias consignado.',
          ),
        ).toBeVisible()

        await test.step('la hoja mide 210 mm, su alto es múltiplo de 297 mm y las columnas cortas no se parten', async () => {
          const medida = await medirHoja(page)
          expectHojaA4(medida)
          expectFirmasSinCruzar(medida)
          expectColumnasCortasEnUnRenglon(medida)
        })

        await test.step('con filas de más, el bloque de firmas nunca cruza el límite de una página', async () => {
          // Se suman filas de a una (solo en el DOM de la vista previa, nada se guarda) y en cada
          // paso se verifica la regla: tarde o temprano las firmas llegan al fondo útil de la
          // página 1 y la hoja tiene que empujarlas al comienzo de la siguiente.
          let empujadas = false
          let paginas = 1
          for (let paso = 0; paso < 70; paso++) {
            await agregarFilasDeRelleno(hoja, 1)
            await expect
              .poll(
                async () => {
                  const m = await medirHoja(page)
                  try {
                    expectHojaA4(m)
                    expectFirmasSinCruzar(m)
                    return 'ok'
                  } catch (error) {
                    return String(error)
                  }
                },
                {
                  message: `firmas dentro de una página con ${paso + 1} filas de más`,
                },
              )
              .toBe('ok')
            const m = await medirHoja(page)
            paginas = Math.round(m.altoMm / 297)
            const huecoMm = await hoja.evaluate((nodo) => {
              const ultima = nodo.querySelector('table tbody tr:last-child')
              const firmas = nodo.querySelector('[data-print-signatures]')
              if (!ultima || !firmas) return 0
              return (
                (firmas.getBoundingClientRect().top -
                  ultima.getBoundingClientRect().bottom) /
                (96 / 25.4)
              )
            })
            // Hueco normal bajo la tabla: pie + 2,5 rem; mucho más grande = firmas empujadas.
            if (huecoMm > 30) empujadas = true
          }
          expect(paginas, 'las filas de más sumaron páginas').toBeGreaterThan(1)
          expect(empujadas, 'en algún paso las firmas fueron empujadas').toBe(
            true,
          )
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
