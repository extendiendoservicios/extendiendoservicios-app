import { expect, test } from '@playwright/test'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  FRANJAS_MOVIL,
  fijarConsentimiento,
  marcarCambiosVistos,
  POSICION_SIMULADA,
  tareasDelTurno,
  TEXTO,
} from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// TEST-017 (P18.2): fichar inicio y fin con consentimiento (EMP-05, EMP-06, EMP-07, EMP-10,
// EMP-11, EMP-14) con la geoposición concedida y negada (RB-E04, CB-21, P-067, P-091), y dos
// turnos el mismo día en sedes distintas (CB-01, P-065). Cuenta de este archivo: empleado4.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado4') })

/** El botón central de la tabbar (EMP-14). */
function botonFichar(page: import('@playwright/test').Page) {
  return page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByLabel('Fichar')
}

test.describe('con la geoposición concedida', () => {
  test.use({ geolocation: POSICION_SIMULADA, permissions: ['geolocation'] })

  test(
    'turno completo: consentimiento, inicio con coordenadas, cronómetro, tareas, observación, fin y resumen',
    cubre('RB-E01', 'RB-E02', 'RB-E04', 'RB-E05', 'RB-E06', 'P-067', 'P-091'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('fichar-geo')
        const sede = await sc.site(cliente.id, 'fichar-geo')
        // Todo el día: el inicio ya pasó y el fin no, así que registrar el fin "antes del
        // horario previsto" muestra el aviso informativo (P-076).
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        await tareasDelTurno(turno, [
          { title: 'e2e-geo: tarea a completar', required: true },
          { title: 'e2e-geo: tarea no realizada', required: true },
        ])
        const asignacion = await sc.assign(turno, 'empleado4')
        // Estado de una persona que nunca fichó: sin consentimiento dado.
        await fijarConsentimiento('empleado4', false)
        await marcarCambiosVistos('empleado4')

        await test.step('antes del inicio las tareas están en solo lectura, con aviso', async () => {
          await page.goto(`/app/en-curso/${asignacion}/tareas`)
          await expect(
            page.getByText(
              'Todavía no registraste el inicio de este servicio: vas a poder marcar las tareas después de fichar.',
            ),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: 'No realizada' }),
          ).toHaveCount(0)
        })

        await test.step('Hoy muestra el servicio y el botón Fichar pide el consentimiento (EMP-14, EMP-06)', async () => {
          await page.goto('/app')
          await expect(page.getByText(sede.name).first()).toBeVisible()
          await botonFichar(page).click()
          await expect(
            page.getByText(TEXTO.ubicacionConsentimiento),
          ).toBeVisible()
          await page.getByRole('button', { name: 'Continuar' }).click()
          await expect(page).toHaveURL(/\/app\/fichar\/consentimiento/)
          await expect(page.getByText('Tu ubicación al fichar')).toBeVisible()
          await page
            .getByRole('button', { name: 'Aceptar y continuar' })
            .click()
          await expect(page).toHaveURL(/\/app\/fichar\?asignacion=/)
        })

        await test.step('EMP-05: hora de referencia y registro del inicio', async () => {
          await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
          await page.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/en-curso/${asignacion}$`),
          )
        })

        await test.step('EMP-07: el cronómetro corre y se ve el fin previsto', async () => {
          await expect(page.getByText(/Iniciado a las/)).toContainText(
            'fin previsto 23:59',
          )
          const cronometro = page.getByText(/^\d{1,2}:\d{2}(:\d{2})?$/)
          await expect(cronometro).toBeVisible()
          const primero = await cronometro.textContent()
          await expect
            .poll(async () => cronometro.textContent())
            .not.toBe(primero)
          await expectNoHorizontalScroll(page)
        })

        await test.step('EMP-08: completar, "no realizada" con motivo y deshacer', async () => {
          await page.getByRole('link', { name: /Tareas/ }).click()
          await page
            .getByRole('checkbox', {
              name: 'Marcar "e2e-geo: tarea a completar" como completada',
            })
            .click()
          await expect(page.getByText(/Completada \d{2}:\d{2}/)).toBeVisible()

          await page.getByRole('button', { name: 'No realizada' }).click()
          await page
            .getByLabel('Motivo')
            .fill('e2e: no había insumos para esta tarea')
          await page
            .getByRole('button', { name: 'Marcar no realizada' })
            .click()
          await expect(
            page.getByText(
              'No realizada · e2e: no había insumos para esta tarea',
            ),
          ).toBeVisible()

          await page
            .getByRole('checkbox', {
              name: '"e2e-geo: tarea no realizada" no realizada. Tocá para deshacer.',
            })
            .click()
          await expect(page.getByText('Pendiente')).toBeVisible()
        })

        await test.step('EMP-09: la observación se guarda y queda al volver', async () => {
          await page.goto(`/app/en-curso/${asignacion}/observaciones`)
          const nota = 'e2e-geo: quedó todo en orden, sin novedades.'
          await page
            .getByPlaceholder('Escribí tu observación (opcional)…')
            .fill(nota)
          await page.getByRole('button', { name: 'Guardar' }).click()
          await expect(page.getByText('Observación guardada.')).toBeVisible()
          await page.goto(`/app/en-curso/${asignacion}/observaciones`)
          await expect(
            page.getByPlaceholder('Escribí tu observación (opcional)…'),
          ).toHaveValue(nota)
        })

        await test.step('EMP-10: avisos de tarea obligatoria pendiente y de salida anticipada', async () => {
          await page.goto(`/app/en-curso/${asignacion}/finalizar`)
          await expect(
            page.getByText(/Tenés 1 tarea obligatoria pendiente/),
          ).toBeVisible()
          await expect(page.getByText(TEXTO.salidaAnticipada)).toBeVisible()
          const registrarFin = page.getByRole('button', {
            name: 'Registrar fin',
          })
          await expect(
            registrarFin,
            'los avisos no bloquean (P-076)',
          ).toBeEnabled()
          await registrarFin.click()
          await expect(page).toHaveURL(
            new RegExp(`/app/resumen/${asignacion}$`),
          )
        })

        await test.step('EMP-11: el resumen muestra inicio, fin, duración y la observación', async () => {
          await expect(page.getByText('Inicio', { exact: true })).toBeVisible()
          await expect(page.getByText('Fin', { exact: true })).toBeVisible()
          await expect(page.getByText('Duración')).toBeVisible()
          await expect(
            page.getByText('e2e-geo: quedó todo en orden, sin novedades.'),
          ).toBeVisible()
          await expectNoHorizontalScroll(page)
        })

        await test.step('después del fin, las tareas vuelven a solo lectura', async () => {
          await page.goto(`/app/en-curso/${asignacion}/tareas`)
          await expect(
            page.getByText(
              'Ya registraste el fin de este servicio: las tareas quedaron como estaban en ese momento.',
            ),
          ).toBeVisible()
        })

        await test.step('en la Base: coordenadas guardadas, asignación finished, turno completed, consentimiento dado', async () => {
          const { data: registros } = await sc.db
            .from('attendance_records')
            .select('kind, latitude, longitude, accuracy_m')
            .eq('assignment_id', asignacion)
          const inicio = registros?.find((r) => r.kind === 'check_in')
          const fin = registros?.find((r) => r.kind === 'check_out')
          for (const r of [inicio, fin]) {
            expect(r?.latitude).not.toBeNull()
            expect(r?.longitude).not.toBeNull()
            expect(r?.accuracy_m).not.toBeNull()
          }
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
          const { data: perfil } = await sc.db
            .from('profiles')
            .select('location_consent_at')
            .eq('id', readId('empleado4'))
            .single()
          expect(perfil?.location_consent_at).not.toBeNull()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CB-01: dos turnos el mismo día en sedes distintas, Hoy los ordena y Fichar apunta al que corresponde',
    cubre('CB-01', 'RB-E02', 'RB-E04', 'P-065'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('dos-turnos')
        const sedeA = await sc.site(cliente.id, 'dos-turnos-a')
        const sedeB = await sc.site(cliente.id, 'dos-turnos-b')
        // A (00:00–00:01) y B (14:00–18:00): no se superponen y A va primero.
        const turnoA = await sc.shift(
          cliente.id,
          sedeA.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const turnoB = await sc.shift(
          cliente.id,
          sedeB.id,
          sc.today,
          FRANJAS.tarde,
        )
        const asignacionB = await sc.assign(turnoB, 'empleado4')
        const asignacionA = await sc.assign(turnoA, 'empleado4')
        await fijarConsentimiento('empleado4', true)
        await marcarCambiosVistos('empleado4')

        await test.step('Hoy los muestra en orden de horario', async () => {
          await page.goto('/app')
          await expect(page.getByText(sedeA.name)).toBeVisible()
          await expect(page.getByText(sedeB.name)).toBeVisible()
          const yA = (await page.getByText(sedeA.name).boundingBox())!.y
          const yB = (await page.getByText(sedeB.name).boundingBox())!.y
          expect(yA).toBeLessThan(yB)
        })

        await test.step('con dos por empezar, Fichar pide elegir y se inicia el segundo', async () => {
          await botonFichar(page).click()
          await expect(
            page.getByText(
              'Tenés más de un servicio hoy. ¿Cuál vas a empezar?',
            ),
          ).toBeVisible()
          await page
            .getByRole('radio', { name: new RegExp(sedeB.name) })
            .click()
          await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
          await page.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/en-curso/${asignacionB}$`),
          )
        })

        await test.step('con B en curso, Fichar vuelve a B (no a A)', async () => {
          await page.goto('/app')
          await botonFichar(page).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/en-curso/${asignacionB}$`),
          )
          await page.goto(`/app/en-curso/${asignacionB}/finalizar`)
          await page.getByRole('button', { name: 'Registrar fin' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/resumen/${asignacionB}$`),
          )
        })

        await test.step('cerrado B, Fichar va directo a A, sin volver a pedir elegir', async () => {
          await page.goto('/app')
          await botonFichar(page).click()
          await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
          await expect(
            page.getByText('Tenés más de un servicio hoy'),
          ).toHaveCount(0)
          await page.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/en-curso/${asignacionA}$`),
          )
          await page.goto(`/app/en-curso/${asignacionA}/finalizar`)
          await page.getByRole('button', { name: 'Registrar fin' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/resumen/${asignacionA}$`),
          )
        })

        await test.step('en la Base: dos asignaciones, dos inicios y dos fines', async () => {
          const { data: registros } = await sc.db
            .from('attendance_records')
            .select('assignment_id, kind')
            .in('assignment_id', [asignacionA, asignacionB])
          expect(registros).toHaveLength(4)
          for (const id of [asignacionA, asignacionB]) {
            const propios = registros!.filter((r) => r.assignment_id === id)
            expect(propios.map((r) => r.kind).sort()).toEqual([
              'check_in',
              'check_out',
            ])
          }
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('con la geoposición negada', () => {
  // Sin conceder el permiso, el navegador deniega `getCurrentPosition` solo (P-091).
  test.use({ permissions: [] })

  test(
    'acepta el consentimiento de la app pero el navegador niega el permiso: inicio y fin sin coordenadas',
    cubre('RB-E04', 'CB-21', 'P-067', 'P-091'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('fichar-sin-geo')
        const sede = await sc.site(cliente.id, 'fichar-sin-geo')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const asignacion = await sc.assign(turno, 'empleado4')
        await fijarConsentimiento('empleado4', false)
        await marcarCambiosVistos('empleado4')

        await page.goto('/app/fichar')
        await page.getByRole('button', { name: 'Continuar' }).click()
        await page.getByRole('button', { name: 'Aceptar y continuar' }).click()
        await expect(page).toHaveURL(/\/app\/fichar\?asignacion=/)
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page).toHaveURL(new RegExp(`/app/en-curso/${asignacion}$`))

        await page.goto(`/app/en-curso/${asignacion}/finalizar`)
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(page).toHaveURL(new RegExp(`/app/resumen/${asignacion}$`))

        const { data: registros } = await sc.db
          .from('attendance_records')
          .select('kind, latitude, longitude')
          .eq('assignment_id', asignacion)
        expect(registros).toHaveLength(2)
        for (const r of registros ?? []) {
          expect(r.latitude, `${r.kind} sin latitud`).toBeNull()
          expect(r.longitude, `${r.kind} sin longitud`).toBeNull()
        }
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'rechaza el consentimiento ("Continuar sin ubicación"): registra igual y la segunda vez no se lo vuelve a pedir',
    cubre('RB-E04', 'CB-21', 'P-091'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('fichar-rechaza')
        const sedeA = await sc.site(cliente.id, 'fichar-rechaza-a')
        const sedeB = await sc.site(cliente.id, 'fichar-rechaza-b')
        const turnoA = await sc.shift(
          cliente.id,
          sedeA.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const turnoB = await sc.shift(
          cliente.id,
          sedeB.id,
          sc.today,
          FRANJAS.tarde,
        )
        const asignacionA = await sc.assign(turnoA, 'empleado4')
        const asignacionB = await sc.assign(turnoB, 'empleado4')
        await fijarConsentimiento('empleado4', false)
        await marcarCambiosVistos('empleado4')

        await test.step('primera vez: elige el servicio A, ve el consentimiento y lo rechaza', async () => {
          await page.goto('/app/fichar')
          await page
            .getByRole('radio', { name: new RegExp(sedeA.name) })
            .click()
          await page.getByRole('button', { name: 'Continuar' }).click()
          await expect(page).toHaveURL(/\/app\/fichar\/consentimiento/)
          await page
            .getByRole('button', { name: 'Continuar sin ubicación' })
            .click()
          await expect(page).toHaveURL(/\/app\/fichar\?asignacion=/)
          await page.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/en-curso/${asignacionA}$`),
          )
          await page.goto(`/app/en-curso/${asignacionA}/finalizar`)
          await page.getByRole('button', { name: 'Registrar fin' }).click()
          await expect(page).toHaveURL(/\/app\/resumen\//)
        })

        await test.step('segunda vez: va directo al registro, sin consentimiento', async () => {
          await page.goto('/app/fichar')
          await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
          await expect(page).not.toHaveURL(/consentimiento/)
          await expect(
            page.getByText(TEXTO.ubicacionConsentimiento),
          ).toHaveCount(0)
          await page.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/app/en-curso/${asignacionB}$`),
          )
        })

        await test.step('en la Base: ninguna coordenada, y el consentimiento sigue sin darse', async () => {
          const { data: registros } = await sc.db
            .from('attendance_records')
            .select('latitude, longitude')
            .in('assignment_id', [asignacionA, asignacionB])
          expect(registros).toHaveLength(3)
          for (const r of registros ?? []) {
            expect(r.latitude).toBeNull()
            expect(r.longitude).toBeNull()
          }
          const { data: perfil } = await sc.db
            .from('profiles')
            .select('location_consent_at')
            .eq('id', readId('empleado4'))
            .single()
          expect(perfil?.location_consent_at).toBeNull()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
