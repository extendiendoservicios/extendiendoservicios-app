import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  fichar,
  FRANJAS_MOVIL,
  fijarConsentimiento,
  POSICION_SIMULADA,
  tarjetaDeTurno,
} from '../../fixtures/movil.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P24.5: la jornada del coordinador a 390 px con la geolocalización simulada (CJ-07, CJ-08, CJ-10,
// CJ-12, CJ-13, CJ-16, CJ-20, CJ-21, CJ-26, CJ-27, CJ-29, CJ-30; SUP-02 a SUP-06 y SUP-08).
// Cuenta: supervisor1; empleado1 y empleado2 son los empleados del turno.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

/** Fila de empleado en SUP-04 con el nombre dado. */
function filaDe(page: Page, nombre: string) {
  return page
    .locator('div.flex.items-center.justify-between.gap-2')
    .filter({ hasText: nombre })
}

/** La barra de jornada de SUP-02. */
function barra(page: Page) {
  return page.getByTestId('workday-bar')
}

/** Eventos vigentes de la jornada de hoy del coordinador, en orden, leídos con la clave de servicio. */
async function eventosDe(sc: Scenario, who: 'supervisor1' | 'supervisor2') {
  const { data: jornada } = await sc.db
    .from('supervisor_workdays')
    .select('id')
    .eq('supervisor_id', readId(who))
    .eq('work_date', sc.today)
    .maybeSingle()
  if (!jornada) return []
  const { data } = await sc.db
    .from('supervisor_workday_events')
    .select('kind, reason, latitude, longitude, accuracy_m, removed_at')
    .eq('workday_id', jornada.id)
    .is('removed_at', null)
    .order('recorded_at')
    .order('seq')
  return data ?? []
}

test.describe('con la geoposición concedida', () => {
  test.use({
    storageState: storageStatePath('supervisor1'),
    geolocation: POSICION_SIMULADA,
    permissions: ['geolocation'],
  })

  test(
    'jornada completa: iniciar con consentimiento, pausar con motivo, reanudar, supervisar, calificar a todos, cerrar, finalizar, reabrir e historial',
    cubre(
      'RB-S01',
      'RB-S04',
      'RB-S05',
      'CJ-07',
      'CJ-08',
      'CJ-10',
      'CJ-12',
      'CJ-13',
      'CJ-16',
      'CJ-20',
      'CJ-21',
      'CJ-26',
      'CJ-29',
      'CJ-30',
      'P-091',
    ),
    async ({ page }) => {
      test.setTimeout(300_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('jornada')
        const sede = await sc.site(cliente.id, 'jornada')
        // Todo el día: el inicio ya pasó y el fin no (la ventana de calificación sigue abierta).
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
          2,
        )
        const asignacionUno = await sc.assign(turno, 'empleado1')
        const asignacionDos = await sc.assign(turno, 'empleado2')
        await fijarConsentimiento('empleado1', true)
        await fijarConsentimiento('empleado2', true)
        await fichar('empleado1', asignacionUno, 'inicio')
        await fichar('empleado2', asignacionDos, 'inicio')
        // Sin jornada previa y sin consentimiento: el estado de quien nunca usó la ubicación.
        await sc.tomarCoordinador('supervisor1')
        await fijarConsentimiento('supervisor1', false)

        await test.step('SUP-02: sin iniciar, la barra ofrece solo «Iniciar jornada»', async () => {
          await page.goto('/sup')
          await expect(barra(page)).toContainText('Sin iniciar')
          await expect(barra(page)).toContainText(
            'Todavía no iniciaste la jornada.',
          )
          await expect(
            barra(page).getByRole('button', { name: 'Iniciar jornada' }),
          ).toBeEnabled()
          await expect(
            barra(page).getByRole('button', { name: 'Pausar' }),
          ).toHaveCount(0)
          await expectNoHorizontalScroll(page)
        })

        await test.step('CJ-07: sin jornada iniciada, «Supervisar» está deshabilitado y dice por qué', async () => {
          await tarjetaDeTurno(page, sede.name).click()
          await expect(page).toHaveURL(new RegExp(`/sup/turnos/${turno}$`))
          await expect(
            page.getByRole('button', { name: 'Supervisar' }),
          ).toBeDisabled()
          await expect(
            page.getByText('Iniciá tu jornada para poder supervisar.'),
          ).toBeVisible()
          await page.goBack()
        })

        await test.step('CJ-21, CJ-20: iniciar pide el consentimiento y registra el inicio con la posición', async () => {
          await barra(page)
            .getByRole('button', { name: 'Iniciar jornada' })
            .click()
          await expect(
            page.getByRole('heading', {
              name: 'Tu ubicación al fichar',
              level: 1,
            }),
          ).toBeVisible()
          await page
            .getByRole('button', { name: 'Aceptar y continuar' })
            .click()
          await expect(barra(page)).toContainText('En actividad')
          await expect(barra(page)).toContainText(/Iniciada a las \d{2}:\d{2}/)
          await expect(barra(page).getByTestId('workday-counter')).toBeVisible()
          const eventos = await eventosDe(sc, 'supervisor1')
          expect(eventos.map((e) => e.kind)).toEqual(['start'])
          // La posición del PRIMER evento tras aceptar el consentimiento no se afirma: en el Chromium
          // de pruebas, el segundo `getCurrentPosition` seguido del que hace el propio consentimiento
          // espera los 6 s de tiempo máximo y el evento se registra sin coordenadas (CJ-21). Las
          // coordenadas se afirman en los eventos siguientes, ya con el consentimiento dado.
          const { data: perfil } = await sc.db
            .from('profiles')
            .select('location_consent_at')
            .eq('id', readId('supervisor1'))
            .single()
          expect(perfil?.location_consent_at).not.toBeNull()
        })

        await test.step('CJ-16: pausar con motivo; en pausa no se puede supervisar', async () => {
          await barra(page).getByRole('button', { name: 'Pausar' }).click()
          const dialogo = page.getByRole('dialog')
          await expect(dialogo).toContainText('Pausar la jornada')
          await dialogo
            .getByLabel('Motivo de la pausa')
            .fill('e2e-jornada: almuerzo')
          await dialogo.getByRole('button', { name: 'Pausar' }).click()
          await expect(barra(page)).toContainText('En pausa')
          await expect(barra(page)).toContainText(/En pausa desde las/)
          await expect(barra(page)).toContainText('e2e-jornada: almuerzo')
          await expect(
            barra(page).getByRole('button', { name: 'Reanudar' }),
          ).toBeEnabled()

          await tarjetaDeTurno(page, sede.name).click()
          await expect(
            page.getByRole('button', { name: 'Supervisar' }),
          ).toBeDisabled()
          await expect(
            page.getByText(
              'Estás en pausa: reanudá tu jornada para poder supervisar.',
            ),
          ).toBeVisible()
          await page.goBack()
          const eventos = await eventosDe(sc, 'supervisor1')
          expect(eventos.map((e) => e.kind)).toEqual(['start', 'pause'])
          expect(eventos[1].reason).toBe('e2e-jornada: almuerzo')
          expect(eventos[1].latitude, 'la pausa trae posición').not.toBeNull()
        })

        await test.step('reanudar vuelve a «En actividad»', async () => {
          await barra(page).getByRole('button', { name: 'Reanudar' }).click()
          await expect(barra(page)).toContainText('En actividad')
          expect(
            (await eventosDe(sc, 'supervisor1')).map((e) => e.kind),
          ).toEqual(['start', 'pause', 'resume'])
        })

        let supervisionId = ''
        await test.step('CJ-26: «Supervisar» registra el inicio de la supervisión en un solo paso', async () => {
          await tarjetaDeTurno(page, sede.name).click()
          await expect(
            page.getByText('Ningún otro coordinador lo supervisa por ahora.'),
          ).toBeVisible()
          await page.getByRole('button', { name: 'Supervisar' }).click()
          await expect(page.getByTestId('attendance-result')).toBeVisible()
          await page
            .getByTestId('attendance-result')
            .getByRole('button', { name: 'Seguir con la supervisión' })
            .click()
          await expect(page).toHaveURL(/\/sup\/supervisiones\/[0-9a-f-]{36}$/)
          supervisionId = page.url().split('/').pop()!
          await expect(page.getByText(/Iniciada a las/)).toBeVisible()

          const { data: sup } = await sc.db
            .from('supervisions')
            .select('status, workday_id, supervisor_id')
            .eq('id', supervisionId)
            .single()
          expect(sup?.status).toBe('in_progress')
          expect(sup?.workday_id, 'colgada de la jornada').not.toBeNull()
          expect(sup?.supervisor_id).toBe(readId('supervisor1'))
          const { data: marcas } = await sc.db
            .from('supervision_attendance')
            .select('kind, latitude')
            .eq('supervision_id', supervisionId)
          expect(marcas).toHaveLength(1)
          expect(marcas![0].kind).toBe('check_in')
          expect(marcas![0].latitude).not.toBeNull()
          expect(
            (await eventosDe(sc, 'supervisor1')).map((e) => e.kind),
          ).toEqual(['start', 'pause', 'resume', 'supervision_start'])
        })

        await test.step('CJ-29: supervisando, «Pausar» y «Finalizar jornada» quedan deshabilitados con su motivo', async () => {
          await page.goto('/sup')
          await expect(barra(page)).toContainText('Supervisando')
          await expect(
            barra(page).getByRole('button', { name: 'Pausar' }),
          ).toBeDisabled()
          await expect(
            barra(page).getByRole('button', { name: 'Finalizar jornada' }),
          ).toBeDisabled()
          await expect(barra(page)).toContainText(
            'Cerrá o descartá tu supervisión para poder pausar o finalizar la jornada.',
          )
        })

        await test.step('CJ-08: con una supervisión abierta no se puede tomar otro turno', async () => {
          const otraSede = await sc.site(cliente.id, 'jornada-otra')
          await sc.shift(
            cliente.id,
            otraSede.id,
            sc.today,
            FRANJAS_MOVIL.diaCompleto,
          )
          await page.reload()
          await tarjetaDeTurno(page, otraSede.name).click()
          await expect(
            page.getByRole('button', { name: 'Supervisar' }),
          ).toBeDisabled()
          await expect(
            page.getByText(
              'Cerrá o descartá tu supervisión abierta antes de empezar otra.',
            ),
          ).toBeVisible()
        })

        await test.step('CJ-10: «Cerrar supervisión» queda bloqueado mientras falte calificar, con la lista de faltantes', async () => {
          await page.goto(`/sup/supervisiones/${supervisionId}`)
          await expect(
            page.getByText(/Para cerrar la supervisión falta calificar a:/),
          ).toContainText(nombreDe('empleado1'))
          await expect(
            page.getByText(/Para cerrar la supervisión falta calificar a:/),
          ).toContainText(nombreDe('empleado2'))
          await expect(
            page.getByRole('button', { name: 'Cerrar supervisión' }),
          ).toBeDisabled()
          await expect(
            page.getByRole('button', { name: 'Descartar' }),
          ).toBeVisible()
        })

        await test.step('CJ-10: calificar a uno no alcanza; al calificar al segundo se habilita el cierre', async () => {
          await filaDe(page, nombreDe('empleado1'))
            .getByRole('link', { name: 'Calificar' })
            .click()
          await page.getByRole('radio', { name: '4 de 5 estrellas' }).click()
          await page
            .getByRole('button', { name: 'Guardar calificación' })
            .click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${supervisionId}$`),
          )
          await expect(
            page.getByText(/Para cerrar la supervisión falta calificar a:/),
          ).not.toContainText(nombreDe('empleado1'))
          await expect(
            page.getByRole('button', { name: 'Cerrar supervisión' }),
          ).toBeDisabled()
          // Con una calificación cargada ya no se puede descartar (CJ-27).
          await expect(
            page.getByRole('button', { name: 'Descartar' }),
          ).toHaveCount(0)

          await filaDe(page, nombreDe('empleado2'))
            .getByRole('link', { name: 'Calificar' })
            .click()
          await page.getByRole('radio', { name: '5 de 5 estrellas' }).click()
          await page
            .getByRole('button', { name: 'Guardar calificación' })
            .click()
          await expect(
            page.getByRole('link', { name: 'Cerrar supervisión' }),
          ).toBeVisible()
        })

        await test.step('cerrar registra el fin y vuelve a Hoy; la jornada sigue en actividad', async () => {
          await page.getByRole('link', { name: 'Cerrar supervisión' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${supervisionId}/cerrar$`),
          )
          await expect(page.getByText('Calificaste a 2 de 2')).toBeVisible()
          await page
            .getByPlaceholder('Nota general (opcional)…')
            .fill('e2e-jornada: todo en orden')
          await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
          await expect(page).toHaveURL(/\/sup$/)
          await expect(barra(page)).toContainText('En actividad')

          const { data: sup } = await sc.db
            .from('supervisions')
            .select('status, general_notes')
            .eq('id', supervisionId)
            .single()
          expect(sup).toEqual({
            status: 'completed',
            general_notes: 'e2e-jornada: todo en orden',
          })
          const { data: marcas } = await sc.db
            .from('supervision_attendance')
            .select('kind')
            .eq('supervision_id', supervisionId)
          expect((marcas ?? []).map((m) => m.kind).sort()).toEqual([
            'check_in',
            'check_out',
          ])
        })

        await test.step('CJ-27: el turno ya supervisado no se puede volver a tomar', async () => {
          await tarjetaDeTurno(page, sede.name).click()
          await expect(
            page.getByRole('button', { name: 'Supervisar' }),
          ).toBeDisabled()
          await expect(
            page.getByText('Ya supervisaste este turno.').first(),
          ).toBeVisible()
          await page.goBack()
        })

        await test.step('finalizar: queda «Finalizada» y solo se ofrece «Reabrir jornada»', async () => {
          await barra(page)
            .getByRole('button', { name: 'Finalizar jornada' })
            .click()
          await expect(barra(page)).toContainText('Finalizada')
          await expect(barra(page)).toContainText(
            /Finalizada a las \d{2}:\d{2}/,
          )
          await expect(
            barra(page).getByRole('button', { name: 'Reabrir jornada' }),
          ).toBeEnabled()
          await expect(
            barra(page).getByRole('button', { name: 'Pausar' }),
          ).toHaveCount(0)
          const { data } = await sc.db
            .from('supervisor_workdays')
            .select('ended_at, auto_closed')
            .eq('supervisor_id', readId('supervisor1'))
            .eq('work_date', sc.today)
            .single()
          expect(data?.ended_at).not.toBeNull()
          expect(data?.auto_closed).toBe(false)
        })

        await test.step('CJ-30: reabrir deja la jornada en actividad y el hueco cuenta como pausa «Jornada reabierta»', async () => {
          await barra(page)
            .getByRole('button', { name: 'Reabrir jornada' })
            .click()
          await expect(barra(page)).toContainText('En actividad')
          const eventos = await eventosDe(sc, 'supervisor1')
          expect(eventos.map((e) => e.kind)).toEqual([
            'start',
            'pause',
            'resume',
            'supervision_start',
            'supervision_end',
            'end',
            'reopen',
          ])
          expect(eventos.at(-1)?.reason).toBe('Jornada reabierta')
          await barra(page)
            .getByRole('button', { name: 'Finalizar jornada' })
            .click()
          await expect(barra(page)).toContainText('Finalizada')
        })

        await test.step('SUP-08: el historial muestra la jornada con horas, pausas y la supervisión', async () => {
          await page
            .getByRole('navigation')
            .getByRole('link', { name: 'Historial' })
            .click()
          await expect(page).toHaveURL(/\/sup\/historial$/)
          const tarjeta = page
            .locator('[data-slot="card"]')
            .filter({ hasText: sede.name })
          await expect(tarjeta).toContainText('Finalizada')
          await expect(tarjeta).toContainText(/\d+ pausas?/)
          await expect(tarjeta).toContainText('Supervisiones')
          await expect(tarjeta).toContainText(cliente.name)
          await expectNoHorizontalScroll(page)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CJ-27: descartar una supervisión empezada por error la cancela y permite volver a tomar el turno',
    cubre('RB-S01', 'CJ-26', 'CJ-27'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('descartar')
        const sede = await sc.site(cliente.id, 'descartar')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        await fijarConsentimiento('supervisor1', true)
        const supervision = await sc.tomarSupervision(turno, 'supervisor1')

        await page.goto(`/sup/supervisiones/${supervision}`)
        await page.getByRole('button', { name: 'Descartar' }).click()
        await expect(page.getByRole('dialog')).toContainText(
          '¿Descartar la supervisión?',
        )
        await page
          .getByRole('button', { name: 'Descartar supervisión' })
          .click()
        await expect(page).toHaveURL(/\/sup$/)

        const { data } = await sc.db
          .from('supervisions')
          .select('status, cancel_reason')
          .eq('id', supervision)
          .single()
        expect(data).toEqual({
          status: 'cancelled',
          cancel_reason: 'Descartada por el coordinador',
        })

        // Descartada, el turno vuelve a poder tomarse y la jornada puede pausarse.
        await expect(barra(page)).toContainText('En actividad')
        await expect(
          barra(page).getByRole('button', { name: 'Pausar' }),
        ).toBeEnabled()
        await tarjetaDeTurno(page, sede.name).click()
        await expect(
          page.getByRole('button', { name: 'Supervisar' }),
        ).toBeEnabled()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('con la geoposición negada', () => {
  // Sin conceder el permiso, el navegador deniega `getCurrentPosition` solo (P-091).
  test.use({ storageState: storageStatePath('supervisor2'), permissions: [] })

  test(
    'CJ-20, CJ-21: aceptando el consentimiento pero con el permiso negado, los eventos se registran igual, sin coordenadas («Sin ubicación»)',
    cubre('RB-S01', 'CJ-20', 'CJ-21', 'CB-21', 'P-091'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('jornada-sin-geo')
        const sede = await sc.site(cliente.id, 'jornada-sin-geo')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        await sc.tomarCoordinador('supervisor2')
        await fijarConsentimiento('supervisor2', false)

        await page.goto('/sup')
        await barra(page)
          .getByRole('button', { name: 'Iniciar jornada' })
          .click()
        await page.getByRole('button', { name: 'Aceptar y continuar' }).click()
        await expect(barra(page)).toContainText('En actividad')

        await tarjetaDeTurno(page, sede.name).click()
        await page.getByRole('button', { name: 'Supervisar' }).click()
        await page
          .getByTestId('attendance-result')
          .getByRole('button', { name: 'Seguir con la supervisión' })
          .click()
        await expect(page.getByText(/Iniciada a las/)).toBeVisible()

        const eventos = await eventosDe(sc, 'supervisor2')
        expect(eventos.map((e) => e.kind)).toEqual([
          'start',
          'supervision_start',
        ])
        for (const e of eventos) {
          expect(e.latitude, `${e.kind} sin latitud`).toBeNull()
          expect(e.longitude, `${e.kind} sin longitud`).toBeNull()
        }
        const supervision = page.url().split('/').pop()!
        const { data: marcas } = await sc.db
          .from('supervision_attendance')
          .select('latitude, longitude')
          .eq('supervision_id', supervision)
        expect(marcas).toEqual([{ latitude: null, longitude: null }])
        expect(turno).toBeTruthy()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CJ-21: «Continuar sin ubicación» deja iniciar la jornada igual y no guarda consentimiento',
    cubre('RB-S01', 'CJ-21', 'CB-21', 'P-091'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        await sc.tomarCoordinador('supervisor2')
        await fijarConsentimiento('supervisor2', false)
        await page.goto('/sup')
        await barra(page)
          .getByRole('button', { name: 'Iniciar jornada' })
          .click()
        await page
          .getByRole('button', { name: 'Continuar sin ubicación' })
          .click()
        await expect(barra(page)).toContainText('En actividad')
        const eventos = await eventosDe(sc, 'supervisor2')
        expect(eventos.map((e) => e.kind)).toEqual(['start'])
        expect(eventos[0].latitude).toBeNull()
        const { data: perfil } = await sc.db
          .from('profiles')
          .select('location_consent_at')
          .eq('id', readId('supervisor2'))
          .single()
        expect(perfil?.location_consent_at).toBeNull()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
