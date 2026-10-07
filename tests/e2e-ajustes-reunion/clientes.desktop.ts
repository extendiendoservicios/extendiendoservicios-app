import { expect, test, type Page } from '@playwright/test'
import { FIXED_ACCOUNTS, type FixedAccountKey } from '../fixtures/accounts.ts'
import { daysFromToday, todayAR } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import { elegirFecha, partesDe } from './helpers/fechas.ts'
import { cargarJornada, sumarAlTurno } from './helpers/historial.ts'

// P19.5d · AJ-09 y AJ-10 (módulo F): resumen por cliente y horas del mes en Clientes.
//   - Pestaña «Resumen de servicios» con período Desde–Hasta, totales (turnos realizados, empleados
//     distintos, horas), detalle por turno y «Descargar resumen» (hoja membretada, una firma).
//   - Columna «Horas (mes)» del listado de Clientes: coincide con el resumen del mes en curso.
// Los turnos son de HOY con franjas y horas de pared fijas (la asistencia se carga con la clave de
// servicio): el resultado no depende de la hora de la corrida, y "hoy" siempre cae dentro del mes
// en curso. Cuentas: empleado1 a empleado4.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('admin') })

/** «Apellido, Nombre» como lo arma el resumen. */
function apellidoNombre(clave: FixedAccountKey): string {
  return `${FIXED_ACCOUNTS[clave].lastName}, ${FIXED_ACCOUNTS[clave].firstName}`
}

declare global {
  interface Window {
    __impresiones?: number
  }
}

async function interceptarImpresion(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__impresiones = 0
    window.print = () => {
      window.__impresiones = (window.__impresiones ?? 0) + 1
    }
  })
}

test(
  'el resumen del cliente cuenta turnos realizados, empleados distintos y horas, y la columna «Horas (mes)» coincide',
  cubre('RB-A06', 'RB-A01', 'P-102'),
  async ({ page }) => {
    test.setTimeout(240_000)
    await interceptarImpresion(page)
    const hoy = todayAR()
    const sc = new Scenario()
    try {
      const cliente = await sc.client('resumen')
      const vacio = await sc.client('resumen-sin-horas')
      const sedeA = await sc.site(cliente.id, 'resumen-a')
      const sedeB = await sc.site(cliente.id, 'resumen-b')

      // S1 (sede A, 8 a 11, dotación 2): empleado1 180 min y empleado2 120 min.
      const s1 = await cargarJornada(sc, {
        cliente,
        sede: sedeA,
        fecha: hoy,
        franja: { start: '08:00', end: '11:00' },
        quien: 'empleado1',
        entrada: '08:00',
        salida: '11:00',
        dotacion: 2,
      })
      await sumarAlTurno(sc, s1.shiftId, {
        cliente,
        sede: sedeA,
        fecha: hoy,
        franja: { start: '08:00', end: '11:00' },
        quien: 'empleado2',
        entrada: '08:00',
        salida: '10:00',
      })
      // S2 (sede B, 14 a 16): empleado1 120 min.
      await cargarJornada(sc, {
        cliente,
        sede: sedeB,
        fecha: hoy,
        franja: { start: '14:00', end: '16:00' },
        quien: 'empleado1',
        entrada: '14:00',
        salida: '16:00',
      })
      // S3 (sede A, 20 a 22): empleado3 asignado, sin ningún registro: no es un turno realizado.
      await cargarJornada(sc, {
        cliente,
        sede: sedeA,
        fecha: hoy,
        franja: { start: '20:00', end: '22:00' },
        quien: 'empleado3',
      })
      // S4 (sede B, 17 a 18): empleado4 con registros, pero el turno se cancela: tampoco cuenta.
      const s4 = await cargarJornada(sc, {
        cliente,
        sede: sedeB,
        fecha: hoy,
        franja: { start: '17:00', end: '18:00' },
        quien: 'empleado4',
        entrada: '17:00',
        salida: '17:30',
      })
      const owner = await sessionClient('owner')
      const cancelado = await owner.rpc('cancel_shift', {
        p_shift_id: s4.shiftId,
        p_reason: 'e2e: cancelado para que no cuente',
      })
      expect(cancelado.error, cancelado.error?.message).toBeNull()

      await test.step('pestaña «Resumen de servicios»: totales coherentes con los datos', async () => {
        await page.goto(`/admin/clientes/${cliente.id}`)
        await page.getByRole('tab', { name: 'Resumen de servicios' }).click()
        await expect(page).toHaveURL(/pestana=resumen/)
        const totales = page.getByRole('region', {
          name: 'Totales del período',
        })
        // Turnos realizados: S1 y S2 (S3 sin registros y S4 cancelado quedan afuera); empleados
        // distintos con inicio: empleado1 y empleado2; horas: 180 + 120 + 120 = 420 min = 7 h.
        await expect(totales).toHaveText(
          /Turnos realizados\s*2\s*Empleados distintos\s*2\s*Horas totales\s*7 h/,
        )

        const tabla = page.getByRole('table', {
          name: 'Turnos realizados del período',
        })
        const filas = tabla.getByRole('row').filter({ has: page.locator('td') })
        await expect(filas).toHaveCount(2)
        const turnoA = filas.filter({ hasText: sedeA.name })
        await expect(turnoA).toHaveCount(1)
        await expect(turnoA).toContainText('08:00–11:00')
        await expect(turnoA).toContainText(apellidoNombre('empleado1'))
        await expect(turnoA).toContainText(apellidoNombre('empleado2'))
        await expect(turnoA).toContainText('5 h')
        const turnoB = filas.filter({ hasText: sedeB.name })
        await expect(turnoB).toHaveCount(1)
        await expect(turnoB).toContainText('14:00–16:00')
        await expect(turnoB).toContainText('2 h')
        // Ni el turno sin registros ni el cancelado aparecen.
        await expect(tabla).not.toContainText(apellidoNombre('empleado3'))
        await expect(tabla).not.toContainText(apellidoNombre('empleado4'))
      })

      await test.step('las tarjetas muestran exactamente lo que devuelve el servidor', async () => {
        const resumen = await owner.rpc('client_service_summary', {
          p_client_id: cliente.id,
          p_from: `${hoy.slice(0, 7)}-01`,
          p_to: hoy,
        })
        expect(resumen.error, resumen.error?.message).toBeNull()
        const datos = resumen.data as unknown as {
          totals: {
            shifts_done: number
            employees_count: number
            worked_minutes: number
          }
        }
        expect(datos.totals).toMatchObject({
          shifts_done: 2,
          employees_count: 2,
          worked_minutes: 420,
        })
      })

      await test.step('cambiar el período: sin turnos el resumen queda en cero', async () => {
        const esPrimeroDeMes = hoy.endsWith('-01')
        if (esPrimeroDeMes) {
          // El día 1 "ayer" es del mes anterior y Desde (el 1) queda posterior a Hasta: la
          // pantalla avisa que el rango no es válido en vez de consultar.
          await elegirFecha(page, 'Hasta', partesDe(daysFromToday(-1)))
          await expect(
            page.getByText(
              'El rango de fechas no es válido: la fecha desde no puede ser posterior a la fecha hasta.',
            ),
          ).toBeVisible()
        } else {
          await elegirFecha(page, 'Hasta', partesDe(daysFromToday(-1)))
          await expect(
            page.getByText('No hubo turnos realizados en este período'),
          ).toBeVisible()
          await expect(
            page.getByRole('region', { name: 'Totales del período' }),
          ).toHaveText(
            /Turnos realizados\s*0\s*Empleados distintos\s*0\s*Horas totales\s*0 min/,
          )
        }
        await elegirFecha(page, 'Hasta', partesDe(hoy))
        await expect(
          page.getByRole('region', { name: 'Totales del período' }),
        ).toContainText('7 h')
      })

      await test.step('«Descargar resumen»: hoja con membrete, cliente, período, tabla, total y una firma', async () => {
        await page.getByRole('button', { name: 'Descargar resumen' }).click()
        const hoja = page.getByRole('dialog', {
          name: new RegExp(`^Resumen de servicios - ${cliente.name} - `),
        })
        await expect(hoja).toBeVisible()
        const logo = hoja.getByRole('img').first()
        await expect(logo).toBeVisible()
        await expect
          .poll(() =>
            logo.evaluate((img) => (img as HTMLImageElement).naturalWidth),
          )
          .toBeGreaterThan(0)
        await expect(
          hoja.getByRole('heading', { name: 'Resumen de servicios' }),
        ).toBeVisible()
        await expect(hoja.getByText('Cliente:')).toBeVisible()
        await expect(
          hoja.getByText(cliente.name, { exact: true }),
        ).toBeVisible()
        await expect(hoja.getByText('CUIT:')).toBeVisible()
        await expect(hoja.getByText('Período:')).toBeVisible()
        await expect(hoja.getByText('Turnos realizados:')).toBeVisible()
        await expect(hoja.getByText('Empleados distintos:')).toBeVisible()
        for (const encabezado of [
          'Fecha',
          'Sede',
          'Franja',
          'Empleados',
          'Horas',
        ]) {
          await expect(
            hoja.getByRole('columnheader', { name: encabezado, exact: true }),
          ).toBeVisible()
        }
        const filas = hoja.getByRole('row').filter({ has: page.locator('td') })
        await expect(filas.filter({ hasText: sedeA.name })).toHaveCount(1)
        await expect(
          hoja.getByRole('row', { name: /Horas totales/ }),
        ).toContainText('7 h')
        // Una sola firma (el responsable de administración), no dos como en la asistencia.
        await expect(
          hoja.getByText('Responsable (administración)'),
        ).toBeVisible()
        await expect(hoja.getByText('Firma', { exact: true })).toHaveCount(1)
        await expect(hoja.getByText('Aclaración', { exact: true })).toHaveCount(
          1,
        )

        await hoja
          .getByRole('button', { name: 'Imprimir o guardar como PDF' })
          .click()
        expect(await page.evaluate(() => window.__impresiones)).toBe(1)
        await hoja.getByRole('button', { name: 'Cerrar' }).click()
        await expect(hoja).toHaveCount(0)
      })

      await test.step('AJ-10: «Horas (mes)» en Clientes coincide con el resumen del mes en curso', async () => {
        await page.goto('/admin/clientes')
        await expect(
          page.getByRole('columnheader', { name: 'Horas (mes)' }),
        ).toBeVisible()
        await page
          .getByPlaceholder('Buscar por nombre o CUIT…')
          .fill(cliente.name)
        const fila = page.getByRole('row').filter({ hasText: cliente.name })
        await expect(fila).toContainText('7 h')
        await page
          .getByPlaceholder('Buscar por nombre o CUIT…')
          .fill(vacio.name)
        await expect(
          page.getByRole('row').filter({ hasText: vacio.name }),
        ).toContainText('0 h')
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'la pestaña «Resumen de servicios» y la lista de Clientes no desbordan a 390 px',
  cubre('RB-A06', 'RB-X05', 'P-102'),
  async ({ page }) => {
    const hoy = todayAR()
    const sc = new Scenario()
    try {
      const cliente = await sc.client('resumen-390')
      const sede = await sc.site(cliente.id, 'resumen-390')
      await cargarJornada(sc, {
        cliente,
        sede,
        fecha: hoy,
        franja: { start: '08:00', end: '11:00' },
        quien: 'empleado3',
        entrada: '08:00',
        salida: '11:00',
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/admin/clientes/${cliente.id}?pestana=resumen`)
      await expect(
        page.getByRole('region', { name: 'Totales del período' }),
      ).toHaveText(
        /Turnos realizados\s*1\s*Empleados distintos\s*1\s*Horas totales\s*3 h/,
      )
      await expect(
        page.getByRole('button', { name: 'Descargar resumen' }),
      ).toBeVisible()
      await expectNoHorizontalScroll(page)

      // En tarjetas, la lista de Clientes rotula la columna con el mes en curso.
      await page.goto('/admin/clientes')
      await page
        .getByPlaceholder('Buscar por nombre o CUIT…')
        .fill(cliente.name)
      const tarjeta = page.getByText(cliente.name).first()
      await expect(tarjeta).toBeVisible()
      await expect(page.getByText(/Horas de [a-zñ]+/).first()).toBeVisible()
      await expect(page.getByText('3 h').first()).toBeVisible()
      await expectNoHorizontalScroll(page)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
