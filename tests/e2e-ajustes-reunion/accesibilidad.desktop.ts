import { expect, test } from '@playwright/test'
import { nombreDe } from '../fixtures/accounts.ts'
import { auditarAccesibilidad, esperarPantallaLista } from '../fixtures/axe.ts'
import { daysFromToday, todayAR } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { chooseMenuItem } from '../fixtures/ui.ts'
import { calificarDirecto, cargarJornada } from './helpers/historial.ts'
import { faltaMargenHaciaAdelante, franjaDesdeAhora } from './helpers/tiempo.ts'

// P19.5d · accesibilidad (axe-core) de las pantallas nuevas o cambiadas por los ajustes de la
// reunión: sin violaciones `critical` ni `serious` (criterio de `fixtures/axe.ts`). Escritorio
// (1280 px) y celular (390 px) de administración; la hoja del celular del empleado está en
// `accesibilidad.movil.ts`.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

/**
 * P19.5h · el membrete de la hoja imprimible no puede duplicar el banner de la página ni dejar
 * regiones repetidas sin nombre (defecto 3 de P19.5d, corregido en P19.5f): ni `moderate` cuenta.
 */
function sinMembreteDuplicado(
  reglas: string[],
  pantalla: string,
  viewport: string,
): void {
  const repetidas = reglas.filter((regla) =>
    /:(landmark-no-duplicate-banner|landmark-unique)$/.test(regla),
  )
  expect(
    repetidas,
    `${pantalla} (${viewport}) repite regiones de página`,
  ).toEqual([])
}

const TAMANOS = [
  { nombre: 'escritorio', width: 1280, height: 900 },
  { nombre: 'celular', width: 390, height: 844 },
] as const

test.describe('axe: administración, pantallas de los ajustes', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'listado de Empleados con la columna Calificación, ficha con Asistencia, hojas imprimibles y resumen del cliente',
    cubre('RB-X01', 'RB-A06', 'P-102'),
    async ({ page }, testInfo) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('axe-aj')
        const sede = await sc.site(cliente.id, 'axe-aj')
        const { shiftId, assignmentId } = await cargarJornada(sc, {
          cliente,
          sede,
          fecha: todayAR(),
          franja: { start: '08:00', end: '11:00' },
          quien: 'empleado1',
          entrada: '08:00',
          salida: '11:00',
        })
        await cargarJornada(sc, {
          cliente,
          sede,
          fecha: daysFromToday(-1),
          franja: { start: '08:00', end: '11:00' },
          quien: 'empleado2',
          entrada: '08:00',
          salida: '10:30',
        })
        const supervision = await sc.assignSupervision(shiftId, 'supervisor1')
        await calificarDirecto(sc, supervision, assignmentId, 4)

        for (const tamano of TAMANOS) {
          await page.setViewportSize({
            width: tamano.width,
            height: tamano.height,
          })

          await page.goto('/admin/empleados')
          await page
            .getByPlaceholder('Buscar por nombre, DNI o legajo…')
            .fill('E2E-Fijo-AJ')
          await expect(
            page.getByText(nombreDe('empleado1')).first(),
          ).toBeVisible()
          await esperarPantallaLista(page)
          await auditarAccesibilidad(
            page,
            testInfo,
            'AJ-04 Empleados con calificación',
            tamano.nombre,
          )

          await page.goto(`/admin/empleados/${readId('empleado1')}`)
          await page.getByRole('tab', { name: 'Asistencia' }).click()
          await expect(page.getByText(sede.name).first()).toBeVisible()
          await esperarPantallaLista(page)
          await auditarAccesibilidad(
            page,
            testInfo,
            'AJ-06 Ficha: Asistencia',
            tamano.nombre,
          )

          await page.getByRole('button', { name: 'Descargar detalle' }).click()
          await expect(
            page.getByRole('dialog', { name: /^Detalle de asistencia - / }),
          ).toBeVisible()
          const resumenHoja = await auditarAccesibilidad(
            page,
            testInfo,
            'AJ-06 Hoja de asistencia',
            tamano.nombre,
          )
          sinMembreteDuplicado(
            resumenHoja.reglas,
            'AJ-06 Hoja de asistencia',
            tamano.nombre,
          )
          await page.keyboard.press('Escape')

          await page.goto(`/admin/clientes/${cliente.id}?pestana=resumen`)
          await expect(page.getByText(sede.name).first()).toBeVisible()
          await esperarPantallaLista(page)
          await auditarAccesibilidad(
            page,
            testInfo,
            'AJ-09 Resumen de servicios',
            tamano.nombre,
          )
          await page.getByRole('button', { name: 'Descargar resumen' }).click()
          await expect(
            page.getByRole('dialog', { name: /^Resumen de servicios - / }),
          ).toBeVisible()
          const resumenHojaResumen = await auditarAccesibilidad(
            page,
            testInfo,
            'AJ-09 Hoja del resumen',
            tamano.nombre,
          )
          sinMembreteDuplicado(
            resumenHojaResumen.reglas,
            'AJ-09 Hoja del resumen',
            tamano.nombre,
          )
          await page.keyboard.press('Escape')

          await page.goto('/admin/clientes')
          await page
            .getByPlaceholder('Buscar por nombre o CUIT…')
            .fill(cliente.name)
          await expect(page.getByText(cliente.name).first()).toBeVisible()
          await esperarPantallaLista(page)
          await auditarAccesibilidad(
            page,
            testInfo,
            'AJ-10 Clientes con Horas (mes)',
            tamano.nombre,
          )
        }
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'Mi perfil con el formulario de nombre y apellido, y el tablero con filas «En camino»',
    cubre('RB-X01', 'RB-A06', 'RB-E07'),
    async ({ page }, testInfo) => {
      const motivo = faltaMargenHaciaAdelante(45, 60)
      test.skip(motivo !== null, motivo ?? '')
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('axe-aj2')
        const sede = await sc.site(cliente.id, 'axe-aj2')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          franjaDesdeAhora(45, 60),
        )
        const asignacion = await sc.assign(turno, 'empleado3')
        const empleado = await sessionClient('empleado3')
        const aviso = await empleado.rpc('notify_on_the_way', {
          p_assignment_id: asignacion,
          p_eta_minutes: 20,
        })
        expect(aviso.error, aviso.error?.message).toBeNull()

        for (const tamano of TAMANOS) {
          await page.setViewportSize({
            width: tamano.width,
            height: tamano.height,
          })
          await page.goto('/perfil')
          await expect(page.locator('#profile-first-name')).toBeVisible()
          await esperarPantallaLista(page)
          await auditarAccesibilidad(
            page,
            testInfo,
            'AJ-01 Mi perfil con nombre editable',
            tamano.nombre,
          )

          await page.goto('/admin')
          await expect(page.getByText(sede.name).first()).toBeVisible()
          await expect(
            page.getByText(/llega ~\d{2}:\d{2}/).first(),
          ).toBeVisible()
          await esperarPantallaLista(page)
          await auditarAccesibilidad(
            page,
            testInfo,
            'AJ-02 Tablero con En camino',
            tamano.nombre,
          )
        }
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('axe: el diálogo «Editar nombre» del dueño', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'el diálogo abierto no tiene violaciones críticas ni serias',
    cubre('RB-X01', 'RB-A01'),
    async ({ page }, testInfo) => {
      for (const tamano of TAMANOS) {
        await page.setViewportSize({
          width: tamano.width,
          height: tamano.height,
        })
        await page.goto('/admin/configuracion/usuarios')
        await expect(
          page.getByRole('heading', { name: 'Usuarios y roles' }),
        ).toBeVisible()
        await chooseMenuItem(
          page,
          `Acciones para ${nombreDe('empleado2')}`,
          'Editar nombre',
        )
        await expect(
          page.getByRole('dialog', { name: 'Editar nombre' }),
        ).toBeVisible()
        await auditarAccesibilidad(
          page,
          testInfo,
          'AJ-01 Diálogo Editar nombre',
          tamano.nombre,
        )
        await page.keyboard.press('Escape')
      }
    },
  )
})
