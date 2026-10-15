import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../fixtures/accounts.ts'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { FRANJAS_MOVIL } from '../fixtures/movil.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import {
  desplazar,
  distanciaM,
  ficharComoEmpleado,
  ficharComoSupervisor,
  redondear,
  SEDE_COORDS,
  sedeGeo,
} from './helpers/geo.ts'

// P22.5 · ADM-02 Resumen: mapa de presencia (B-11 a B-15) y «Fuera de zona» en «Requiere atención»
// (B-21). Los fichajes se hacen con las RPC reales y las sesiones de las cuentas fijas, con
// posiciones a distancias conocidas de la sede (radio propio de 100 m). Cuentas: empleado1 a
// empleado4 y supervisor1; mira `admin` (todas las capacidades) y `adminSinCapacidades`.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

const RADIO = 100
const ADENTRO = desplazar(SEDE_COORDS, 60)
const AFUERA = desplazar(SEDE_COORDS, 0, 450)
const FINALIZADO = desplazar(SEDE_COORDS, 0, 40)
const SUPERVISOR = desplazar(SEDE_COORDS, -60)

const mapa = (page: Page) =>
  page.getByRole('region', { name: 'Mapa de presencia' })
const punto = (page: Page, etiqueta: string) =>
  mapa(page).getByTitle(etiqueta, { exact: true })
/** El pin es un `div` con una clase de color del design system (`bg-success`, `bg-danger`, `bg-text-3`). */
const color = (page: Page, etiqueta: string, clase: string) =>
  punto(page, etiqueta).locator(`span.${clase}`)

/** Una sede con turno hoy y cinco fichajes reales: dentro, fuera, sin ubicación, finalizado y supervisor. */
async function armarPresencia(sc: Scenario) {
  const cliente = await sc.client('geo-presencia')
  const sede = await sedeGeo(sc, cliente, 'geo-presencia', { radio: RADIO })
  const turno = await sc.shift(
    cliente.id,
    sede.id,
    sc.today,
    FRANJAS_MOVIL.diaCompleto,
    4,
  )
  const asig = {
    dentro: await sc.assign(turno, 'empleado1'),
    fuera: await sc.assign(turno, 'empleado2'),
    sinUbicacion: await sc.assign(turno, 'empleado3'),
    finalizado: await sc.assign(turno, 'empleado4'),
  }
  const supervision = await sc.assignSupervision(turno, 'supervisor1')
  await ficharComoEmpleado('empleado1', asig.dentro, 'inicio', {
    punto: ADENTRO,
    precision: 12,
  })
  await ficharComoEmpleado(
    'empleado2',
    asig.fuera,
    'inicio',
    { punto: AFUERA, precision: 12 },
    'e2e: motivo del empleado',
  )
  await ficharComoEmpleado('empleado3', asig.sinUbicacion, 'inicio')
  await ficharComoEmpleado('empleado4', asig.finalizado, 'inicio', {
    punto: FINALIZADO,
    precision: 9,
  })
  await ficharComoEmpleado('empleado4', asig.finalizado, 'fin', {
    punto: FINALIZADO,
    precision: 9,
  })
  await ficharComoSupervisor('supervisor1', supervision, 'inicio', {
    punto: SUPERVISOR,
    precision: 15,
  })
  return { cliente, sede, turno, asig, supervision }
}

test.describe('el dueño o un administrador mira el Resumen', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'ADM-02: puntos verde, rojo y rombo de supervisor, sede con su círculo, «Mostrar finalizados de hoy», «Trabajando sin ubicación» y «Ver turno»',
    cubre(
      'RB-A06',
      'RB-A07',
      'B-03',
      'B-11',
      'B-12',
      'B-13',
      'B-14',
      'B-15',
      'B-40',
    ),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await armarPresencia(sc)
        const nombre = (
          k: 'empleado1' | 'empleado2' | 'empleado3' | 'empleado4',
        ) => nombreDe(k)

        await page.goto('/admin')
        await expect(
          mapa(page).getByRole('heading', { name: 'Dónde está el equipo' }),
        ).toBeVisible()

        await test.step('los empleados en curso con ubicación, con el color de su validación (B-03, B-12)', async () => {
          const dentro = `Empleado ${nombre('empleado1')}`
          const fuera = `Empleado ${nombre('empleado2')}`
          await expect(punto(page, dentro)).toBeVisible()
          await expect(color(page, dentro, 'bg-success')).toHaveCount(1)
          await expect(punto(page, fuera)).toBeVisible()
          await expect(color(page, fuera, 'bg-danger')).toHaveCount(1)
          // Sin ubicación no hay punto; el finalizado todavía no se muestra.
          await expect(
            punto(page, `Empleado ${nombre('empleado3')}`),
          ).toHaveCount(0)
          await expect(
            punto(page, `Empleado ${nombre('empleado4')} (finalizó)`),
          ).toHaveCount(0)
        })

        await test.step('el supervisor con una supervisión en curso, con otro ícono (rombo) (B-12)', async () => {
          const etiqueta = `Supervisor ${nombreDe('supervisor1')}`
          await expect(punto(page, etiqueta)).toBeVisible()
          await expect(
            punto(page, etiqueta).locator('span.rotate-45'),
          ).toHaveCount(1)
          await expect(
            punto(page, etiqueta).locator('span.bg-success'),
          ).toHaveCount(1)
          // Los empleados no llevan rombo.
          await expect(
            punto(page, `Empleado ${nombre('empleado1')}`).locator(
              'span.rotate-45',
            ),
          ).toHaveCount(0)
        })

        await test.step('la sede con turno hoy, con su radio y sin color de alarma (B-14)', async () => {
          const sede = punto(page, `Sede ${t.sede.name}`)
          await expect(sede).toBeVisible()
          await expect(sede.locator('span.bg-primary')).toHaveCount(1)
          // Solo las sedes llevan círculo: hay tantos trazos como sedes (en `App_dev` hay otras
          // sedes con turno hoy, por eso no se cuenta un número fijo).
          await expect
            .poll(
              async () =>
                (await mapa(page)
                  .locator('.leaflet-overlay-pane path')
                  .count()) -
                (await mapa(page).locator('[title^="Sede "]').count()),
              { message: 'un círculo por sede' },
            )
            .toBe(0)
          // Con otras sedes y personas en el mapa los pines pueden superponerse: se dispara el clic del propio pin.
          await sede.dispatchEvent('click')
          await expect(
            page
              .locator('.leaflet-popup-content')
              .getByText('Radio de validación: 100 m'),
          ).toBeVisible()
          await page.keyboard.press('Escape')
        })

        await test.step('al tocar un punto: persona, cliente y sede, horario, inicio, distancia, precisión, estado y «Ver turno» (B-15)', async () => {
          await punto(page, `Empleado ${nombre('empleado2')}`).dispatchEvent(
            'click',
          )
          const popup = page
            .locator('.leaflet-popup-content')
            .filter({ hasText: `${nombre('empleado2')} · Empleado` })
          await expect(popup).toContainText(`${nombre('empleado2')} · Empleado`)
          await expect(popup).toContainText(
            `${t.cliente.name} · ${t.sede.name}`,
          )
          await expect(popup).toContainText('Horario: 00:00 a 23:59')
          await expect(popup).toContainText(/Inicio: \d{2}:\d{2}/)
          await expect(popup).toContainText(
            `Distancia a la sede: ${redondear(distanciaM(SEDE_COORDS, AFUERA))} m`,
          )
          await expect(popup).toContainText('Precisión del GPS: 12 m')
          await expect(popup).toContainText('Fuera de zona')
          // B-40: nada de coordenadas en el texto.
          await expect(popup).not.toContainText(String(AFUERA.lat).slice(0, 8))
          await popup.getByRole('link', { name: 'Ver turno' }).click()
          await expect(page).toHaveURL(new RegExp(`/admin/turnos/${t.turno}$`))
          await expect(
            page.getByRole('dialog', { name: 'Detalle del turno' }),
          ).toBeVisible()
        })

        await test.step('«Trabajando sin ubicación»: cuenta y lista a quien ficha sin posición, con «Ver turno» (B-13)', async () => {
          await page.goto('/admin')
          await expect(
            mapa(page).getByText(/^Trabajando sin ubicación: \d+$/),
          ).toBeVisible()
          const item = mapa(page)
            .getByRole('listitem')
            .filter({ hasText: nombre('empleado3') })
          await expect(item).toContainText(`${t.cliente.name} · ${t.sede.name}`)
          await expect(item).toContainText(/inicio \d{2}:\d{2}/)
          await item.getByRole('link', { name: 'Ver turno' }).click()
          await expect(page).toHaveURL(new RegExp(`/admin/turnos/${t.turno}$`))
        })

        await test.step('«Mostrar finalizados de hoy»: suma al que ya ficho el fin; apagado, desaparece (B-12)', async () => {
          await page.goto('/admin')
          const etiqueta = `Empleado ${nombre('empleado4')} (finalizó)`
          await expect(
            punto(page, `Empleado ${nombre('empleado1')}`),
          ).toBeVisible()
          await expect(punto(page, etiqueta)).toHaveCount(0)
          const interruptor = mapa(page).getByRole('switch', {
            name: 'Mostrar finalizados de hoy',
          })
          await interruptor.click()
          await expect(punto(page, etiqueta)).toBeVisible()
          await expect(color(page, etiqueta, 'bg-success')).toHaveCount(1)
          await interruptor.click()
          await expect(punto(page, etiqueta)).toHaveCount(0)
        })

        await test.step('el fin de un empleado en curso hace desaparecer su punto (B-12)', async () => {
          await page.goto('/admin')
          const etiqueta = `Empleado ${nombre('empleado1')}`
          await expect(punto(page, etiqueta)).toBeVisible()
          await ficharComoEmpleado('empleado1', t.asig.dentro, 'fin', {
            punto: ADENTRO,
            precision: 12,
          })
          await page.reload()
          await expect(
            punto(page, `Empleado ${nombre('empleado2')}`),
          ).toBeVisible()
          await expect(punto(page, etiqueta)).toHaveCount(0)
        })

        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-02: «Requiere atención» suma a quien fichó fuera de zona, con la distancia, y deja de mostrarlo cuando se lo marca como válido',
    cubre('RB-A06', 'RB-A07', 'B-09', 'B-21'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await armarPresencia(sc)
        const titulo = `${nombreDe('empleado2')} fichó fuera de la zona de la sede`
        const distancia = redondear(distanciaM(SEDE_COORDS, AFUERA))

        await page.goto('/admin')
        const tarjeta = page.getByRole('listitem').filter({ hasText: titulo })
        await expect(tarjeta).toHaveCount(1)
        await expect(tarjeta).toContainText(
          `${t.cliente.name} · ${t.sede.name}`,
        )
        await expect(tarjeta).toContainText(`a ${distancia} m de la sede`)
        // Los que fichan dentro de la zona o sin ubicación no suman a este aviso.
        for (const quien of ['empleado1', 'empleado3', 'empleado4'] as const) {
          await expect(
            page
              .getByRole('listitem')
              .filter({ hasText: `${nombreDe(quien)} fichó fuera de la zona` }),
          ).toHaveCount(0)
        }

        const admin = await sessionClient('admin')
        const { data: fichaje } = await sc.db
          .from('attendance_records')
          .select('id')
          .eq('assignment_id', t.asig.fuera)
          .eq('kind', 'check_in')
          .single()
        const v = await admin.rpc('override_geo_validation', {
          p_record_type: 'attendance',
          p_record_id: fichaje!.id,
          p_reason: 'e2e: el GPS no anda en el subsuelo',
        })
        expect(v.error, v.error?.message).toBeNull()

        await page.reload()
        await expect(
          page.getByRole('listitem').filter({ hasText: titulo }),
          'marcado como válido: ya no requiere atención',
        ).toHaveCount(0)
        // El punto del mapa pasa a verde (B-09: «Validado (corregido)»).
        const etiqueta = `Empleado ${nombreDe('empleado2')}`
        await expect(punto(page, etiqueta)).toBeVisible()
        await expect(color(page, etiqueta, 'bg-success')).toHaveCount(1)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-02: el mapa se actualiza solo, sin recargar (cada 45 s, B-39): un fichaje nuevo aparece sin tocar nada',
    cubre('RB-A06', 'B-11', 'B-39'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('geo-refresco')
        const sede = await sedeGeo(sc, cliente, 'geo-refresco', {
          radio: RADIO,
        })
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
          2,
        )
        const a1 = await sc.assign(turno, 'empleado1')
        const a2 = await sc.assign(turno, 'empleado2')
        await ficharComoEmpleado('empleado1', a1, 'inicio', {
          punto: ADENTRO,
          precision: 10,
        })

        await page.goto('/admin')
        await expect(
          punto(page, `Empleado ${nombreDe('empleado1')}`),
        ).toBeVisible()
        await expect(
          punto(page, `Empleado ${nombreDe('empleado2')}`),
        ).toHaveCount(0)

        // Sin recargar la página: el segundo empleado ficha y el mapa lo toma en el próximo ciclo.
        await ficharComoEmpleado('empleado2', a2, 'inicio', {
          punto: AFUERA,
          precision: 10,
        })
        await expect(
          punto(page, `Empleado ${nombreDe('empleado2')}`),
        ).toBeVisible({ timeout: 75_000 })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('un administrador sin capacidades mira el Resumen', () => {
  test.use({ storageState: storageStatePath('adminSinCapacidades') })

  test(
    'ADM-02: ve el mapa de presencia (es de lectura: dueño y administradores, B-40) pero no puede corregir',
    cubre('RB-A06', 'RB-X02', 'B-40'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        await armarPresencia(sc)
        await page.goto('/admin')
        await expect(
          punto(page, `Empleado ${nombreDe('empleado1')}`),
        ).toBeVisible()
        await expect(
          punto(page, `Empleado ${nombreDe('empleado2')}`),
        ).toBeVisible()
        await expect(
          mapa(page)
            .getByRole('listitem')
            .filter({ hasText: nombreDe('empleado3') }),
        ).toHaveCount(1)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
