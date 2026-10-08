import { expect, test, type Locator } from '@playwright/test'
import { getAdminDb, nombreDe } from '../fixtures/accounts.ts'
import { daysFromToday } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { calificarDirecto, cargarJornada } from './helpers/historial.ts'

// P19.5d · AJ-04 y AJ-05 (módulo F, P-088): calificación promedio.
//   - Columna «Calificación» en el listado de Empleados: estrellas, promedio con una decimal y
//     coma, cantidad de calificaciones, ordenable; «Sin calificaciones» si no tiene.
//   - Tercera línea de la ficha con el mismo indicador.
//   - Coincide con el promedio de las calificaciones realmente cargadas (se calcula desde la base).
// Fechas pasadas (ayer y antes) con horas fijas: no dependen de la hora de la corrida.
// Cuentas: empleado1 (tres calificaciones), empleado2 (una) y empleado3 (ninguna).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('admin') })

/** Promedio y cantidad reales de las calificaciones de un empleado, según la base. */
async function promedioReal(profileId: string) {
  const { data, error } = await getAdminDb()
    .from('ratings')
    .select('score, assignments!inner(employee_id)')
    .eq('assignments.employee_id', profileId)
  expect(error, error?.message).toBeNull()
  const puntajes = (data ?? []).map((fila) => fila.score)
  const cantidad = puntajes.length
  const promedio = cantidad
    ? puntajes.reduce((suma, valor) => suma + valor, 0) / cantidad
    : null
  return { cantidad, promedio }
}

/** «4,3» como lo muestra la pantalla (una decimal, coma de Argentina). */
function formatoPantalla(promedio: number): string {
  return promedio.toLocaleString('es-AR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

function textoCantidad(cantidad: number): string {
  return `(${cantidad} ${cantidad === 1 ? 'calificación' : 'calificaciones'})`
}

test(
  'el listado de Empleados y la ficha muestran el promedio de las calificaciones cargadas, y la columna se ordena',
  cubre('RB-A06', 'RB-S04', 'P-088'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('calif')
      const sede = await sc.site(cliente.id, 'calif')
      const base = {
        cliente,
        sede,
        franja: { start: '08:00', end: '11:00' },
        entrada: '08:00',
        salida: '11:00',
      }
      // empleado1: 5, 4 y 4 (promedio 4,33); empleado2: un 2; empleado3: sin calificaciones.
      const puntajes: Array<[string, 'empleado1' | 'empleado2', number]> = [
        [daysFromToday(-1), 'empleado1', 5],
        [daysFromToday(-2), 'empleado1', 4],
        [daysFromToday(-3), 'empleado1', 4],
        [daysFromToday(-4), 'empleado2', 2],
      ]
      for (const [fecha, quien, puntaje] of puntajes) {
        const { shiftId, assignmentId } = await cargarJornada(sc, {
          ...base,
          fecha,
          quien,
        })
        const supervision = await sc.assignSupervision(shiftId, 'supervisor1')
        await calificarDirecto(sc, supervision, assignmentId, puntaje)
      }

      const real1 = await promedioReal(readId('empleado1'))
      const real2 = await promedioReal(readId('empleado2'))
      const real3 = await promedioReal(readId('empleado3'))
      expect(real1.cantidad).toBeGreaterThanOrEqual(3)
      expect(real3.cantidad).toBe(0)

      function filaDe(clave: 'empleado1' | 'empleado2' | 'empleado3'): Locator {
        return page
          .getByRole('row')
          .filter({ hasText: new RegExp(`${nombreDe(clave)}(?!\\d)`) })
      }

      await test.step('listado: estrellas, promedio con coma y cantidad por empleado', async () => {
        await page.goto('/admin/empleados')
        await page
          .getByPlaceholder('Buscar por nombre, DNI o legajo…')
          .fill('E2E-Fijo-AJ')
        await expect(
          page.getByRole('columnheader', { name: /Calificación/ }),
        ).toBeVisible()

        const f1 = filaDe('empleado1')
        await expect(f1).toContainText(formatoPantalla(real1.promedio!))
        await expect(f1).toContainText(textoCantidad(real1.cantidad))
        await expect(
          f1.getByRole('img', {
            name: `${Math.round(real1.promedio!)} de 5 estrellas`,
          }),
        ).toBeVisible()
        const f2 = filaDe('empleado2')
        await expect(f2).toContainText(formatoPantalla(real2.promedio!))
        await expect(f2).toContainText(textoCantidad(real2.cantidad))
        await expect(filaDe('empleado3')).toContainText('Sin calificaciones')
      })

      await test.step('la columna es ordenable: de mayor a menor deja «Sin calificaciones» al final', async () => {
        const encabezado = page.getByRole('columnheader', {
          name: /Calificación/,
        })
        const orden = async () => {
          const filas = page
            .getByRole('row')
            .filter({ hasText: /E2E-Fijo-AJ Empleado[123](?!\d)/ })
          const textos = await filas.allTextContents()
          return textos.map((texto) => /Empleado([123])/.exec(texto)![1])
        }
        await encabezado.getByRole('button').click()
        const sentido = await encabezado.getAttribute('aria-sort')
        expect(['ascending', 'descending']).toContain(sentido)
        const primero = await orden()
        await encabezado.getByRole('button').click()
        const sentidoOpuesto = await encabezado.getAttribute('aria-sort')
        expect(sentidoOpuesto).not.toBe(sentido)
        const segundo = await orden()

        // Los tres, de mayor a menor: 1 (4,3), 2 (2,0) y 3 (sin calificaciones).
        const descendente = sentido === 'descending' ? primero : segundo
        const ascendente = sentido === 'descending' ? segundo : primero
        expect(descendente.filter((n) => n !== undefined)).toEqual([
          '1',
          '2',
          '3',
        ])
        expect(ascendente).toEqual(['3', '2', '1'])
      })

      await test.step('ficha: tercera línea con estrellas, promedio y cantidad', async () => {
        await page.goto(`/admin/empleados/${readId('empleado1')}`)
        await expect(
          page.getByRole('heading', { name: nombreDe('empleado1'), level: 2 }),
        ).toBeVisible()
        const resumen = page.getByTitle(
          `${formatoPantalla(real1.promedio!)} de 5 · ${real1.cantidad} calificaciones`,
        )
        await expect(resumen).toBeVisible()
        await expect(resumen).toContainText(textoCantidad(real1.cantidad))
        await expect(
          resumen.getByRole('img', {
            name: `${Math.round(real1.promedio!)} de 5 estrellas`,
          }),
        ).toBeVisible()
        // Es la tercera línea: debajo del nombre.
        const titulo = await page
          .getByRole('heading', { name: nombreDe('empleado1'), level: 2 })
          .boundingBox()
        const caja = await resumen.boundingBox()
        expect(caja!.y).toBeGreaterThan(titulo!.y + titulo!.height - 1)

        await page.goto(`/admin/empleados/${readId('empleado3')}`)
        await expect(page.getByText('Sin calificaciones')).toBeVisible()
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
