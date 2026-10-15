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
  borrarEventosDeCorrecciones,
  desplazar,
  distanciaM,
  ficharComoEmpleado,
  ficharComoSupervisor,
  redondear,
  SEDE_COORDS,
  sedeGeo,
} from './helpers/geo.ts'

// P22.5 · Administración: planilla de asistencia con el filtro «Solo fuera de zona» (B-20), detalle
// del turno (ADM-06) con la validación, la distancia, la precisión, el motivo del empleado, el mini
// mapa de solo lectura y las acciones «Corregir hora» (B-28) y «Marcar como válido» (B-09), ambas
// con motivo obligatorio, y el detalle de la supervisión (ADM-15). Fichajes reales por RPC.
// Cuentas: empleado1 a empleado3, supervisor1; miran `admin` y `adminSinCapacidades`.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

const RADIO = 100
const AFUERA = desplazar(SEDE_COORDS, 450)
const MOTIVO_EMPLEADO = 'e2e: el GPS no anda en el subsuelo'
const ID_FICHAJES: string[] = []

const detalle = (page: Page) =>
  page.getByRole('dialog', { name: 'Detalle del turno' })

/** Un turno de hoy con una sola persona que ficha afuera (con motivo): el detalle es inequívoco. */
async function turnoConUnaPersona(sc: Scenario, slug: string) {
  const cliente = await sc.client(slug)
  const sede = await sedeGeo(sc, cliente, slug, { radio: RADIO })
  const turno = await sc.shift(
    cliente.id,
    sede.id,
    sc.today,
    FRANJAS_MOVIL.diaCompleto,
  )
  const asignacion = await sc.assign(turno, 'empleado1')
  await ficharComoEmpleado(
    'empleado1',
    asignacion,
    'inicio',
    { punto: AFUERA, precision: 12 },
    MOTIVO_EMPLEADO,
  )
  const { data } = await sc.db
    .from('attendance_records')
    .select('id')
    .eq('assignment_id', asignacion)
    .eq('kind', 'check_in')
    .single()
  ID_FICHAJES.push(data!.id)
  return { cliente, sede, turno, asignacion, fichajeId: data!.id }
}

test.describe('el dueño o un administrador con manage_attendance', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'ADM-10: la planilla muestra la validación de cada fichaje y el filtro «Solo fuera de zona» deja solo los rojos sin corregir',
    cubre('RB-A06', 'RB-A07', 'B-03', 'B-09', 'B-20'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('geo-planilla')
        const sede = await sedeGeo(sc, cliente, 'geo-planilla', {
          radio: RADIO,
        })
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
          3,
        )
        const a1 = await sc.assign(turno, 'empleado1')
        const a2 = await sc.assign(turno, 'empleado2')
        const a3 = await sc.assign(turno, 'empleado3')
        await ficharComoEmpleado('empleado1', a1, 'inicio', {
          punto: SEDE_COORDS,
          precision: 10,
        })
        await ficharComoEmpleado('empleado2', a2, 'inicio', {
          punto: AFUERA,
          precision: 12,
        })
        await ficharComoEmpleado('empleado3', a3, 'inicio')

        await page.goto('/admin/asistencia')
        await page
          .getByRole('combobox', { name: 'Filtrar por cliente' })
          .click()
        await page.getByRole('option', { name: cliente.name }).click()
        const tabla = page.getByRole('table', { name: /^Asistencia del / })
        await expect(
          tabla.getByRole('columnheader', { name: 'Validación' }),
        ).toBeVisible()
        const fila = (k: 'empleado1' | 'empleado2' | 'empleado3') =>
          tabla.getByRole('row').filter({ hasText: nombreDe(k) })
        const distancia = redondear(distanciaM(SEDE_COORDS, AFUERA))

        await test.step('cada fila muestra su resultado: «Validado», «Fuera de zona · N m» y «Sin validar»', async () => {
          await expect(fila('empleado1')).toContainText('Validado')
          await expect(fila('empleado2')).toContainText(
            `Fuera de zona · ${distancia} m`,
          )
          await expect(fila('empleado3')).toContainText('Sin validar')
          await expect(tabla).not.toContainText(String(AFUERA.lat).slice(0, 8))
        })

        await test.step('«Solo fuera de zona» deja solo a quien quedó en rojo', async () => {
          await page.getByRole('switch', { name: 'Solo fuera de zona' }).click()
          await expect(fila('empleado2')).toHaveCount(1)
          await expect(fila('empleado1')).toHaveCount(0)
          await expect(fila('empleado3')).toHaveCount(0)
        })

        await test.step('marcado como válido, ya no está en el filtro pero sigue en la planilla como «Validado (corregido)»', async () => {
          const { data: fichaje } = await sc.db
            .from('attendance_records')
            .select('id')
            .eq('assignment_id', a2)
            .eq('kind', 'check_in')
            .single()
          ID_FICHAJES.push(fichaje!.id)
          const admin = await sessionClient('admin')
          const v = await admin.rpc('override_geo_validation', {
            p_record_type: 'attendance',
            p_record_id: fichaje!.id,
            p_reason: 'e2e: motivo de la corrección',
          })
          expect(v.error, v.error?.message).toBeNull()
          await page.reload()
          await page
            .getByRole('combobox', { name: 'Filtrar por cliente' })
            .click()
          await page.getByRole('option', { name: cliente.name }).click()
          await page.getByRole('switch', { name: 'Solo fuera de zona' }).click()
          await expect(fila('empleado2')).toHaveCount(0)
          await page.getByRole('switch', { name: 'Solo fuera de zona' }).click()
          await expect(fila('empleado2')).toContainText('Validado (corregido)')
          await expectNoHorizontalScroll(page)
        })
      } finally {
        await borrarEventosDeCorrecciones(sc, ID_FICHAJES.splice(0))
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-06: el detalle del turno muestra la validación, la distancia, la precisión, el motivo del empleado y el mini mapa de solo lectura',
    cubre('RB-A06', 'RB-A07', 'B-03', 'B-04', 'B-18', 'B-20', 'B-40'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoConUnaPersona(sc, 'geo-detalle')
        await page.goto(`/admin/turnos/${t.turno}`)
        await expect(detalle(page)).toBeVisible()
        const d = detalle(page)
        await expect(d).toContainText('Fuera de zona')
        await expect(d).toContainText(
          `Distancia a la sede: ${redondear(distanciaM(SEDE_COORDS, AFUERA))} m (radio 100 m)`,
        )
        await expect(d).toContainText('Precisión del GPS: 12 m')
        await expect(d).toContainText(`Motivo del empleado: ${MOTIVO_EMPLEADO}`)
        await expect(
          d.getByRole('button', { name: 'Corregir hora' }),
        ).toBeVisible()
        await expect(
          d.getByRole('button', { name: 'Marcar como válido' }),
        ).toBeVisible()
        // B-40: nada de coordenadas escritas.
        await expect(d).not.toContainText(String(AFUERA.lat).slice(0, 8))

        await test.step('el mini mapa se abre con «Ver en el mapa» (sede, radio y punto del fichaje) y se oculta', async () => {
          await d.getByRole('button', { name: 'Ver en el mapa' }).click()
          await expect(
            d.getByRole('group', {
              name: new RegExp(
                `^Mapa con la sede ${t.sede.name} y el punto del fichaje guardado: fuera de la zona\\.$`,
              ),
            }),
          ).toBeVisible()
          await expect(
            d.getByRole('button', { name: 'Ocultar mapa' }),
          ).toHaveAttribute('aria-expanded', 'true')
          // El círculo de la sede y el de precisión del punto.
          await expect(d.locator('.leaflet-overlay-pane path')).toHaveCount(2)
          await d.getByRole('button', { name: 'Ocultar mapa' }).click()
          await expect(
            d.getByRole('group', { name: /^Mapa con la sede/ }),
          ).toHaveCount(0)
        })
        await expectNoHorizontalScroll(page)
      } finally {
        await borrarEventosDeCorrecciones(sc, ID_FICHAJES.splice(0))
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-06: «Corregir hora» pide un motivo, respeta el día y la hora actual, deja la hora anterior y se ve como «Corregido»',
    cubre('RB-A06', 'RB-A08', 'B-28', 'B-41', 'CB-08'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoConUnaPersona(sc, 'geo-hora')
        const horaAntes = (
          await sc.db
            .from('attendance_records')
            .select('recorded_at')
            .eq('id', t.fichajeId)
            .single()
        ).data!.recorded_at

        await page.goto(`/admin/turnos/${t.turno}`)
        const d = detalle(page)
        await d.getByRole('button', { name: 'Corregir hora' }).click()
        const dialogo = page.getByRole('dialog', {
          name: 'Corregir hora de inicio',
        })
        await expect(dialogo).toBeVisible()
        const hora = dialogo.getByLabel('Hora nueva')
        const motivo = dialogo.getByLabel('Motivo')
        const aplicar = dialogo.getByRole('button', { name: 'Corregir hora' })

        await test.step('el motivo es obligatorio', async () => {
          await hora.fill(`${sc.today}T00:05`)
          await aplicar.click()
          await expect(dialogo.getByText('Escribí el motivo.')).toBeVisible()
          expect(
            (
              await sc.db
                .from('attendance_corrections')
                .select('id')
                .eq('attendance_record_id', t.fichajeId)
            ).data,
          ).toEqual([])
        })

        await test.step('una hora futura se rechaza con el mensaje del plan', async () => {
          const manana = new Date(Date.now() + 3 * 3_600_000)
          const local = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'America/Argentina/Buenos_Aires',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
            .format(manana)
            .replace(' ', 'T')
          await hora.fill(local)
          await motivo.fill('e2e: hora futura')
          await aplicar.click()
          await expect(
            dialogo.getByText(
              'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
            ),
          ).toBeVisible()
        })

        await test.step('una hora válida se guarda: queda la anterior, quién y por qué, y el detalle dice «Corregido»', async () => {
          await hora.fill(`${sc.today}T00:05`)
          await motivo.fill('e2e: fichó tarde por un problema de señal')
          await aplicar.click()
          await expect(
            page.getByText('Corregimos la hora de inicio.'),
          ).toBeVisible()
          await expect(dialogo).toHaveCount(0)
          await expect(d).toContainText('Inicio 00:05')
          await expect(d.getByText('Corregido', { exact: true })).toBeVisible()
          await expect(d).toContainText('Historial de correcciones')
          await expect(d).toContainText(
            /Corrigió la hora de inicio: \d{2}:\d{2} → 00:05/,
          )
          await expect(d).toContainText(
            'Motivo: e2e: fichó tarde por un problema de señal',
          )

          const { data: corr } = await sc.db
            .from('attendance_corrections')
            .select('kind, old_recorded_at, new_recorded_at, reason')
            .eq('attendance_record_id', t.fichajeId)
          expect(corr).toHaveLength(1)
          expect(corr![0].kind).toBe('time')
          expect(Date.parse(corr![0].old_recorded_at!)).toBe(
            Date.parse(horaAntes),
          )
          expect(Date.parse(corr![0].new_recorded_at!)).toBe(
            Date.parse(`${sc.today}T00:05:00-03:00`),
          )
          const { data: evento } = await sc.db
            .from('security_events')
            .select('event_type')
            .eq('event_type', 'attendance_time_corrected')
            .eq('details->>record_id', t.fichajeId)
          expect(evento, 'la corrección queda en security_events').toHaveLength(
            1,
          )
        })

        await test.step('el valor original de la validación no se toca (B-41)', async () => {
          const { data } = await sc.db
            .from('attendance_records')
            .select('geo_status, outside_reason')
            .eq('id', t.fichajeId)
            .single()
          expect(data).toMatchObject({
            geo_status: 'outside',
            outside_reason: MOTIVO_EMPLEADO,
          })
        })
      } finally {
        await borrarEventosDeCorrecciones(sc, ID_FICHAJES.splice(0))
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-06: «Marcar como válido» pide un motivo, deja «Validado (corregido)», conserva el original y no se ofrece dos veces',
    cubre('RB-A06', 'RB-A08', 'B-09', 'B-41'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoConUnaPersona(sc, 'geo-valido')
        await page.goto(`/admin/turnos/${t.turno}`)
        const d = detalle(page)
        await d.getByRole('button', { name: 'Marcar como válido' }).click()
        const dialogo = page.getByRole('dialog', { name: 'Marcar como válido' })
        await expect(dialogo).toBeVisible()
        const confirmar = dialogo.getByRole('button', {
          name: 'Marcar como válido',
        })

        await test.step('sin motivo no se puede confirmar', async () => {
          await expect(confirmar).toBeDisabled()
          await dialogo.getByLabel('Motivo').fill('   ')
          await expect(confirmar).toBeDisabled()
        })

        await test.step('con motivo se marca como válido', async () => {
          await dialogo
            .getByLabel('Motivo')
            .fill('e2e: el GPS no anda en el subsuelo del edificio')
          await confirmar.click()
          await expect(
            page.getByText('Marcamos el fichaje como válido.'),
          ).toBeVisible()
          await expect(dialogo).toHaveCount(0)
          await expect(d).toContainText('Validado (corregido)')
          await expect(
            d.getByRole('button', { name: 'Marcar como válido' }),
          ).toHaveCount(0)
          await expect(d).toContainText('Marcó como válido el inicio')
          await expect(d).toContainText(
            'Motivo: e2e: el GPS no anda en el subsuelo del edificio',
          )
        })

        await test.step('en la Base: el resultado original sigue «Fuera de zona»; queda quién, cuándo y por qué', async () => {
          const { data } = await sc.db
            .from('attendance_records')
            .select(
              'geo_status, geo_override_by, geo_override_at, geo_override_reason',
            )
            .eq('id', t.fichajeId)
            .single()
          expect(data?.geo_status).toBe('outside')
          expect(data?.geo_override_by).not.toBeNull()
          expect(data?.geo_override_at).not.toBeNull()
          expect(data?.geo_override_reason).toBe(
            'e2e: el GPS no anda en el subsuelo del edificio',
          )
          const { data: corr } = await sc.db
            .from('attendance_corrections')
            .select('kind')
            .eq('attendance_record_id', t.fichajeId)
          expect(corr?.map((c) => c.kind)).toEqual(['geo'])
        })
      } finally {
        await borrarEventosDeCorrecciones(sc, ID_FICHAJES.splice(0))
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-15: el detalle de la supervisión muestra la validación del inicio y se puede marcar como válido, pero no tiene «Corregir hora»',
    cubre('RB-S01', 'RB-A06', 'B-07', 'B-09'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('geo-sup-detalle')
        const sede = await sedeGeo(sc, cliente, 'geo-sup-detalle', {
          radio: RADIO,
        })
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        const supervision = await sc.assignSupervision(turno, 'supervisor1')
        await ficharComoSupervisor('supervisor1', supervision, 'inicio', {
          punto: AFUERA,
          precision: 15,
        })

        await page.goto(`/admin/supervisiones/${supervision}`)
        await expect(page.getByText('Fuera de zona').first()).toBeVisible()
        await expect(
          page.getByText(/Distancia a la sede: \d+ m \(radio 100 m\)/),
        ).toBeVisible()
        await expect(page.getByText('Precisión del GPS: 15 m')).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Corregir hora' }),
        ).toHaveCount(0)
        await page.getByRole('button', { name: 'Marcar como válido' }).click()
        const dialogo = page.getByRole('dialog', { name: 'Marcar como válido' })
        await dialogo.getByLabel('Motivo').fill('e2e: visita autorizada')
        await dialogo
          .getByRole('button', { name: 'Marcar como válido' })
          .click()
        await expect(
          page.getByText('Marcamos el fichaje como válido.'),
        ).toBeVisible()
        await expect(
          page.getByText('Validado (corregido)').first(),
        ).toBeVisible()
        const { data } = await sc.db
          .from('supervision_attendance')
          .select('id, geo_status, geo_override_reason')
          .eq('supervision_id', supervision)
          .eq('kind', 'check_in')
          .single()
        expect(data?.geo_status, 'el original se conserva').toBe('outside')
        expect(data?.geo_override_reason).toBe('e2e: visita autorizada')
        ID_FICHAJES.push(data!.id)
      } finally {
        await borrarEventosDeCorrecciones(sc, ID_FICHAJES.splice(0))
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('un administrador sin capacidades', () => {
  test.use({ storageState: storageStatePath('adminSinCapacidades') })

  test(
    'ADM-06: ve la validación y el mapa pero no tiene «Corregir hora» ni «Marcar como válido» (manage_attendance)',
    cubre('RB-A06', 'RB-X02', 'B-09', 'B-28'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const t = await turnoConUnaPersona(sc, 'geo-sincap')
        await page.goto(`/admin/turnos/${t.turno}`)
        const d = detalle(page)
        await expect(d).toContainText('Fuera de zona')
        await expect(d).toContainText('Precisión del GPS: 12 m')
        await expect(
          d.getByRole('button', { name: 'Ver en el mapa' }),
        ).toBeVisible()
        await expect(
          d.getByRole('button', { name: 'Corregir hora' }),
        ).toHaveCount(0)
        await expect(
          d.getByRole('button', { name: 'Marcar como válido' }),
        ).toHaveCount(0)
      } finally {
        await borrarEventosDeCorrecciones(sc, ID_FICHAJES.splice(0))
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
