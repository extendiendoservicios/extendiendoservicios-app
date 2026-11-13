import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import {
  FRANJAS,
  isTooCloseToMidnight,
  minutesSinceMidnightAR,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { ejecutarSqlEnAppDev } from '../../fixtures/sql.ts'
import { cubre } from '../../fixtures/trace.ts'
import {
  expectNoHorizontalScroll,
  interceptMapRequests,
} from '../../fixtures/ui.ts'
import { sedeGeo } from '../../e2e-geo/helpers/geo.ts'

// P28.7: asistencia y mapa de las observaciones del 11 nov 2026 (escritorio, 1280 px).
//   - OF-11: cierre automático. Se simula la corrida del cron: `app.auto_close_assignments()` en
//     App_dev (la misma función que programa pg_cron cada 15 minutos).
//   - OF-06 / OF-07: «Corregir» y «Registrar» junto a las horas de Asistencia de hoy y en el detalle.
//   - OF-13: pins del mapa por estado de la sede, conmutadores y su persistencia al recargar.
//   - OF-13b / P28.2: pantalla completa del mapa.
// Empleados de este archivo: empleado3 y empleado4. Los turnos de hoy usan franjas que no dependen
// de la hora: 00:00–00:01 (ya terminó) y 00:00–23:59 (en curso); para «por comenzar» se usa
// 23:50–23:59 y se saltea ese paso a partir de las 23:45.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

const mapa = (page: Page) =>
  page.getByRole('region', { name: 'Mapa de presencia' })
const pinDeSede = (page: Page, nombre: string) =>
  mapa(page).getByTitle(new RegExp(`^Sede ${nombre} \\(`))

test.describe('cierre automático (OF-11)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'la función del cron cierra la asignación sin fin: fin programado, marca «Cierre automático», filtro y turno completado',
    cubre('RB-A06', 'RB-A08', 'CB-05', 'P-069', 'OF-11'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of11')
        const sede = await sc.site(cliente.id, 'of11')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const asignacion = await sc.assign(turno, 'empleado3')
        const empleado = await sessionClient('empleado3')
        const inicio = await empleado.rpc('record_check_in', {
          p_assignment_id: asignacion,
        })
        expect(inicio.error, inicio.error?.message).toBeNull()
        // El empleado «ficha» a las 00:00:30 y nunca registra el fin.
        await sc.db
          .from('attendance_records')
          .update({ recorded_at: `${sc.today}T00:00:30-03:00` })
          .eq('assignment_id', asignacion)
          .eq('kind', 'check_in')

        // Un segundo turno con inicio fichado pero cuyo fin programado es dentro de horas: NO se cierra.
        const turnoLargo = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          { start: '00:02', end: '23:59' },
          1,
        )
        const largo = await sc.assign(turnoLargo, 'empleado4')

        await test.step('antes del cron: el fin sigue vacío', async () => {
          const { data } = await sc.db
            .from('attendance_records')
            .select('id')
            .eq('assignment_id', asignacion)
            .eq('kind', 'check_out')
          expect(data).toHaveLength(0)
        })

        await test.step('se corre app.auto_close_assignments() como lo haría el cron', () => {
          ejecutarSqlEnAppDev('select app.auto_close_assignments();')
        })

        await test.step('el fin quedó con la hora programada, source admin, auto_closed y el motivo; asignación finalizada y turno completado', async () => {
          const { data: fin } = await sc.db
            .from('attendance_records')
            .select('source, reason, auto_closed, recorded_at, recorded_by')
            .eq('assignment_id', asignacion)
            .eq('kind', 'check_out')
            .single()
          expect(fin?.auto_closed).toBe(true)
          expect(fin?.source).toBe('admin')
          expect(fin?.recorded_by).toBeNull()
          expect(fin?.reason).toBe('Cierre automático: no se registró el fin')
          // Hora de fin programada: 00:01 de hoy en Argentina (03:01 UTC).
          expect(new Date(fin!.recorded_at).toISOString()).toBe(
            `${sc.today}T03:01:00.000Z`,
          )
          const { data: a } = await sc.db
            .from('assignments')
            .select('status')
            .eq('id', asignacion)
            .single()
          expect(a?.status).toBe('finished')
          const { data: t } = await sc.db
            .from('shifts')
            .select('status')
            .eq('id', turno)
            .single()
          expect(t?.status).toBe('completed')
          // La otra asignación (fin programado a las 23:59) no se tocó.
          const { data: otro } = await sc.db
            .from('attendance_records')
            .select('id')
            .eq('assignment_id', largo)
            .eq('kind', 'check_out')
          expect(otro).toHaveLength(0)
        })

        await test.step('Asistencia de hoy: la píldora «Cierre automático» y el filtro', async () => {
          await page.goto('/admin/asistencia')
          await page
            .getByPlaceholder('Buscar por nombre…')
            .fill(nombreDe('empleado3'))
          const fila = page
            .locator('li, tr, article')
            .filter({ hasText: nombreDe('empleado3') })
            .filter({ hasText: cliente.name })
            .last()
          await expect(fila).toBeVisible()
          await expect(fila.getByText('Cierre automático')).toBeVisible()
          // Con el filtro prendido sigue estando; la asignación sin cierre automático desaparece.
          await page.getByPlaceholder('Buscar por nombre…').fill('')
          await page.getByRole('switch', { name: 'Cierre automático' }).check()
          await expect(page.getByText(cliente.name).first()).toBeVisible()
          await expect(page.getByText(nombreDe('empleado4'))).toHaveCount(0)
          await expect(
            page.getByText(nombreDe('empleado3')).first(),
          ).toBeVisible()
          // Apagado, vuelve a verse la otra asignación.
          await page
            .getByRole('switch', { name: 'Cierre automático' })
            .uncheck()
          await expect(
            page.getByText(nombreDe('empleado4')).first(),
          ).toBeVisible()
        })

        await test.step('Resumen: la píldora en «Servicios de hoy»', async () => {
          await page.goto('/admin')
          const region = page.getByRole('region', { name: 'Servicios de hoy' })
          await expect(
            region.getByText('Cierre automático').first(),
          ).toBeVisible()
        })

        await test.step('es idempotente: una segunda corrida no vuelve a cerrar nada de esta prueba', async () => {
          ejecutarSqlEnAppDev('select app.auto_close_assignments();')
          const { data } = await sc.db
            .from('attendance_records')
            .select('id')
            .eq('assignment_id', asignacion)
            .eq('kind', 'check_out')
          expect(data).toHaveLength(1)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'una asignación sin inicio fichado no se cierra sola (queda como ausente)',
    cubre('RB-A06', 'CB-05', 'OF-11'),
    async () => {
      test.setTimeout(120_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of11b')
        const sede = await sc.site(cliente.id, 'of11b')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const sinInicio = await sc.assign(turno, 'empleado3')
        ejecutarSqlEnAppDev('select app.auto_close_assignments();')
        const { data } = await sc.db
          .from('attendance_records')
          .select('id')
          .eq('assignment_id', sinInicio)
        expect(
          data,
          'sin inicio fichado no se toca (queda como ausente)',
        ).toHaveLength(0)
        const { data: a } = await sc.db
          .from('assignments')
          .select('status')
          .eq('id', sinInicio)
          .single()
        expect(a?.status).not.toBe('finished')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('«Corregir» y «Registrar» (OF-06, OF-07)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'Asistencia de hoy ofrece «Registrar inicio» sin fichaje (y no «fin»), y «Corregir» cuando ya hay hora',
    cubre('RB-A06', 'RB-A08', 'OF-06', 'OF-07'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of0607')
        const sede = await sc.site(cliente.id, 'of0607')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS.madrugada,
        )
        await sc.assign(turno, 'empleado4')
        const nombre = nombreDe('empleado4')

        await page.goto('/admin/asistencia')
        await page.getByPlaceholder('Buscar por nombre…').fill(nombre)

        await test.step('OF-07: sin fichaje, «Registrar» junto al inicio; no hay «Registrar fin» (no hay fin sin inicio)', async () => {
          await expect(
            page.getByRole('button', { name: `Registrar inicio de ${nombre}` }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: `Registrar fin de ${nombre}` }),
          ).toHaveCount(0)
          await expect(
            page.getByRole('button', {
              name: new RegExp(`^Corregir .* de ${nombre}`),
            }),
          ).toHaveCount(0)
        })

        await test.step('«Registrar» abre la hoja con la acción Inicio ya elegida y registra', async () => {
          await page
            .getByRole('button', { name: `Registrar inicio de ${nombre}` })
            .click()
          const hoja = page.getByRole('dialog', {
            name: `Registrar en nombre de ${nombre}`,
          })
          await expect(hoja).toBeVisible()
          await expect(
            hoja.getByRole('combobox', { name: 'Elegir acción' }),
          ).toContainText('Inicio')
          await hoja
            .getByLabel('Motivo')
            .fill('e2e p28: no pudo fichar desde el celular')
          await hoja.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(page.getByText('Registramos el inicio.')).toBeVisible()
        })

        await test.step('OF-06: con la hora cargada ahora ofrece «Corregir inicio» y «Registrar fin»', async () => {
          await expect(
            page.getByRole('button', { name: `Corregir inicio de ${nombre}` }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: `Registrar fin de ${nombre}` }),
          ).toBeVisible()
        })

        await test.step('«Corregir» abre «Corregir hora de inicio» pidiendo hora y motivo', async () => {
          await page
            .getByRole('button', { name: `Corregir inicio de ${nombre}` })
            .click()
          const dialogo = page.getByRole('dialog', {
            name: /^Corregir hora de inicio/,
          })
          await expect(dialogo).toBeVisible()
          await expect(dialogo.getByLabel('Hora nueva')).toBeVisible()
          await expect(dialogo.getByLabel('Motivo')).toBeVisible()
          // Sin motivo no corrige.
          await dialogo.getByRole('button', { name: 'Corregir hora' }).click()
          await expect(dialogo).toBeVisible()
          await dialogo.getByRole('button', { name: 'Volver' }).click()
          await expect(dialogo).toHaveCount(0)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'el detalle del turno muestra los botones y un admin sin «Gestionar asistencia» no los ve',
    cubre('RB-A06', 'RB-A08', 'CB-17', 'OF-06', 'OF-07'),
    async ({ browser }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of0607d')
        const sede = await sc.site(cliente.id, 'of0607d')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS.madrugada,
        )
        await sc.assign(turno, 'empleado3')
        const nombre = nombreDe('empleado3')

        const conCapacidad = await browser.newContext({
          storageState: storageStatePath('admin'),
        })
        try {
          const page = await conCapacidad.newPage()
          await page.goto(`/admin/turnos/${turno}`)
          await expect(
            page.getByRole('button', { name: `Registrar inicio de ${nombre}` }),
          ).toBeVisible()
        } finally {
          await conCapacidad.close()
        }

        const sinCapacidad = await browser.newContext({
          storageState: storageStatePath('adminSinCapacidades'),
        })
        try {
          const page = await sinCapacidad.newPage()
          await page.goto(`/admin/turnos/${turno}`)
          await expect(
            page.getByRole('dialog', { name: 'Detalle del turno' }),
          ).toBeVisible()
          await expect(page.getByText(nombre).first()).toBeVisible()
          await expect(
            page.getByRole('button', {
              name: /^(Registrar|Corregir) (inicio|fin) de /,
            }),
          ).toHaveCount(0)
          await page.goto('/admin/asistencia')
          await expect(
            page.getByRole('button', {
              name: /^(Registrar|Corregir) (inicio|fin) de /,
            }),
          ).toHaveCount(0)
        } finally {
          await sinCapacidad.close()
        }
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('mapa del Resumen (OF-13, OF-13b)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'las sedes se pintan por estado (por comenzar, en curso, finalizada), los conmutadores las muestran y ocultan y la preferencia persiste al recargar',
    cubre('RB-A07', 'B-11', 'B-14', 'OF-13'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of13')
        const haceFalta = minutesSinceMidnightAR() < 23 * 60 + 45
        const sedeFin = await sedeGeo(sc, cliente, 'of13-fin', { radio: 100 })
        const sedeCurso = await sedeGeo(sc, cliente, 'of13-curso', {
          radio: 100,
        })
        const sedeProx = await sedeGeo(sc, cliente, 'of13-prox', { radio: 100 })
        await sc.shift(cliente.id, sedeFin.id, sc.today, FRANJAS.madrugada)
        await sc.shift(cliente.id, sedeCurso.id, sc.today, {
          start: '00:00',
          end: '23:59',
        })
        if (haceFalta) {
          await sc.shift(cliente.id, sedeProx.id, sc.today, {
            start: '23:50',
            end: '23:59',
          })
        }

        await interceptMapRequests(page)
        await page.goto('/admin')
        await expect(
          mapa(page).getByRole('heading', { name: 'Dónde está el equipo' }),
        ).toBeVisible()

        await test.step('por omisión: «Por comenzar» y «En curso» prendidos; «Finalizados» apagado', async () => {
          await expect(
            mapa(page).getByRole('switch', { name: 'Por comenzar' }),
          ).toBeChecked()
          await expect(
            mapa(page).getByRole('switch', { name: 'En curso' }),
          ).toBeChecked()
          await expect(
            mapa(page).getByRole('switch', { name: 'Finalizados' }),
          ).not.toBeChecked()
          await expect(
            mapa(page).getByRole('switch', { name: 'Coordinadores' }),
          ).toBeVisible()
        })

        await test.step('en curso con el color primario; por comenzar en amarillo con reloj', async () => {
          await expect(pinDeSede(page, sedeCurso.name)).toBeVisible()
          await expect(
            pinDeSede(page, sedeCurso.name).locator('span.bg-primary'),
          ).toHaveCount(1)
          if (haceFalta) {
            await expect(pinDeSede(page, sedeProx.name)).toBeVisible()
            await expect(
              pinDeSede(page, sedeProx.name).locator('span.bg-warning'),
            ).toHaveCount(1)
          }
          // La finalizada no se ve hasta prender «Finalizados».
          await expect(pinDeSede(page, sedeFin.name)).toHaveCount(0)
        })

        await test.step('«Finalizados» muestra la sede en gris y su globo cuenta los turnos por estado', async () => {
          await mapa(page).getByRole('switch', { name: 'Finalizados' }).check()
          await expect(pinDeSede(page, sedeFin.name)).toBeVisible()
          await expect(
            pinDeSede(page, sedeFin.name).locator('span.bg-text-3'),
          ).toHaveCount(1)
          await pinDeSede(page, sedeFin.name).dispatchEvent('click')
          const globo = page.locator('.leaflet-popup-content')
          await expect(globo).toContainText(sedeFin.name)
          await expect(globo).toContainText('Radio de validación: 100 m')
          await page.keyboard.press('Escape')
        })

        await test.step('«En curso» apagado oculta la sede en curso', async () => {
          await mapa(page).getByRole('switch', { name: 'En curso' }).uncheck()
          await expect(pinDeSede(page, sedeCurso.name)).toHaveCount(0)
          if (haceFalta) {
            await expect(pinDeSede(page, sedeProx.name)).toBeVisible()
          }
        })

        await test.step('la preferencia persiste al recargar (por persona)', async () => {
          await page.reload()
          await expect(
            mapa(page).getByRole('switch', { name: 'En curso' }),
          ).not.toBeChecked()
          await expect(
            mapa(page).getByRole('switch', { name: 'Finalizados' }),
          ).toBeChecked()
          await expect(pinDeSede(page, sedeCurso.name)).toHaveCount(0)
          await expect(pinDeSede(page, sedeFin.name)).toBeVisible()
        })

        await test.step('la leyenda nombra los estados', async () => {
          const leyenda = mapa(page).getByRole('list', {
            name: 'Referencias del mapa',
          })
          await expect(leyenda).toContainText(/por comenzar/i)
          await expect(leyenda).toContainText(/en curso/i)
          await expect(leyenda).toContainText(/finaliz/i)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'pantalla completa: «Ampliar mapa» lo expande al viewport y Esc o el mismo botón lo cierran',
    cubre('RB-A07', 'OF-13b'),
    async ({ page }) => {
      test.setTimeout(240_000)
      // P28.9c: el mapa solo se dibuja (y trae «Ampliar mapa») si hay alguna sede para mostrar; antes
      // dependía de datos ajenos de App_dev y de la hora (de noche no queda nadie «en curso»). Se arma
      // una sede ubicable con un turno de todo el día de hoy.
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of13b')
        const sede = await sedeGeo(sc, cliente, 'of13b', { radio: 100 })
        await sc.shift(cliente.id, sede.id, sc.today, {
          start: '00:00',
          end: '23:59',
        })
        await pantallaCompleta(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

async function pantallaCompleta(page: Page) {
  await interceptMapRequests(page)
  await page.goto('/admin')
  const region = mapa(page)
  await expect(
    region.getByRole('heading', { name: 'Dónde está el equipo' }),
  ).toBeVisible()
  const ampliar = region.getByRole('button', { name: 'Ampliar mapa' })
  await expect(ampliar).toBeVisible()
  const caja = await ampliar.boundingBox()
  expect(caja!.width, 'objetivo táctil de 44 px').toBeGreaterThanOrEqual(40)
  await ampliar.click()
  const salir = page.getByRole('button', {
    name: 'Salir de pantalla completa',
  })
  await expect(salir).toBeVisible()
  const viewport = page.viewportSize()!
  await expect
    .poll(async () => {
      const box = await page.locator('.leaflet-container').boundingBox()
      return Math.round(box?.width ?? 0)
    })
    .toBeGreaterThanOrEqual(viewport.width - 4)
  // Esc: en Chromium sin pantalla (Playwright) la tecla no llega al navegador, así que se
  // simula lo que éste hace con ella (salir de la pantalla completa) y la app tiene que enterarse.
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen()
  })
  await expect(page.getByRole('button', { name: 'Ampliar mapa' })).toBeVisible()
  await expect
    .poll(async () => {
      const box = await page.locator('.leaflet-container').boundingBox()
      return Math.round(box?.width ?? 0)
    })
    .toBeLessThan(viewport.width - 40)
  // Y con el mismo botón.
  await page.getByRole('button', { name: 'Ampliar mapa' }).click()
  await page.getByRole('button', { name: 'Salir de pantalla completa' }).click()
  await expect(page.getByRole('button', { name: 'Ampliar mapa' })).toBeVisible()
  await expectNoHorizontalScroll(page)
}
