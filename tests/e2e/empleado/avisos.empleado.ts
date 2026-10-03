import { expect, test, type Page } from '@playwright/test'
import { expectHint } from '../../fixtures/api.ts'
import {
  daysFromToday,
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  contextoDe,
  esperarHastaSegundo,
  hhmm,
  marcarCambiosVistos,
  minutosAhora,
  TEXTO,
} from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-017 (P18.2): avisar demora o ausencia (EMP-12, RB-E07, P-072, P-073) desde el detalle,
// desde Más y desde Hoy; el rechazo después de la hora de inicio y el borde exacto de CB-06
// (un aviso dentro del último minuto se acepta; pasada la hora de inicio se rechaza con
// `TOO_LATE_TO_NOTIFY`). Cuentas de este archivo: empleado1 y, en CB-06, empleado2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado1') })

/** Del servicio elegido al paso "Confirmar aviso" de una ausencia por enfermedad. */
async function prepararAusencia(page: Page, asignacion: string): Promise<void> {
  await page.goto(`/app/avisar?asignacion=${asignacion}`)
  await page.getByRole('radio', { name: 'Ausencia' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('radio', { name: 'Enfermedad' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(
    page.getByText('Vas a avisar que no vas: enfermedad.'),
  ).toBeVisible()
}

test(
  'avisa una demora desde el detalle y después una ausencia; no se repite el mismo aviso y el propio aviso no enciende "Cambios"',
  cubre('RB-E07', 'RB-E02', 'P-072', 'P-073', 'P-092'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('avisos')
      const sede = await sc.site(cliente.id, 'avisos')
      // Mañana: el aviso se acepta a cualquier hora de hoy (todavía no empezó).
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        daysFromToday(1),
        FRANJAS.manana,
      )
      const asignacion = await sc.assign(turno, 'empleado1')
      await marcarCambiosVistos('empleado1')

      await test.step('EMP-04 ofrece avisar, con el servicio ya elegido y los dos tipos', async () => {
        await page.goto(`/app/servicio/${asignacion}`)
        await page
          .getByRole('link', { name: 'Avisar demora o ausencia' })
          .click()
        await expect(page).toHaveURL(
          new RegExp(`/app/avisar\\?asignacion=${asignacion}`),
        )
        await expect(
          page.getByRole('radiogroup', { name: 'Tipo de aviso' }),
        ).toBeVisible()
      })

      await test.step('demora de 15 min (valor por defecto del selector de minutos)', async () => {
        await page.getByRole('radio', { name: 'Demora' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(
          page.getByText('Minutos de demora estimados'),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(
          page.getByText('Vas a avisar una demora de 15 min.'),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Confirmar aviso' }).click()
        await expect(
          page.getByText('Avisaste una demora de 15 min.'),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Volver a Hoy' }).click()
        await expect(page).toHaveURL(/\/app$/)
      })

      await test.step('el detalle muestra el aviso vigente y el estado "Demora avisada"', async () => {
        await page.goto(`/app/servicio/${asignacion}`)
        await expect(
          page.getByText('Avisaste una demora de 15 min.'),
        ).toBeVisible()
        await expect(page.getByText('Demora avisada').first()).toBeVisible()
      })

      await test.step('ya con una demora, solo se puede pasar a ausencia (no se repite el mismo aviso)', async () => {
        await page
          .getByRole('link', { name: 'Avisar demora o ausencia' })
          .click()
        await expect(
          page.getByText('Elegí el motivo.', { exact: false }),
        ).toBeVisible()
        await expect(
          page.getByRole('radiogroup', { name: 'Tipo de aviso' }),
        ).toHaveCount(0)
        await page.getByRole('radio', { name: 'Enfermedad' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(
          page.getByText('Vas a avisar que no vas: enfermedad.'),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Confirmar aviso' }).click()
        await expect(page.getByText('Avisaste que no vas.')).toBeVisible()
      })

      await test.step('con la ausencia avisada, el detalle ya no ofrece avisar', async () => {
        await page.goto(`/app/servicio/${asignacion}`)
        await expect(
          page.getByText('Avisaste que no vas: enfermedad.'),
        ).toBeVisible()
        await expect(page.getByText('Ausencia avisada').first()).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Avisar demora o ausencia' }),
        ).toHaveCount(0)
      })

      await test.step('el propio aviso no enciende "Cambios desde tu última visita" (P-092)', async () => {
        const marcado = page.waitForResponse((r) =>
          r.url().includes('/rpc/mark_changes_seen'),
        )
        await page.goto('/app')
        await expect(page.getByText(sede.name).first()).toBeVisible()
        await marcado
        await expect(
          page.getByText('Cambios desde tu última visita'),
        ).toHaveCount(0)
        await expect(
          page.getByRole('link', { name: 'Avisar demora o ausencia' }),
          'sin servicios por avisar, Hoy no ofrece el atajo',
        ).toHaveCount(0)
      })

      await test.step('en la Base: dos avisos, de origen employee_app', async () => {
        const { data: avisos } = await sc.db
          .from('attendance_notices')
          .select('kind, minutes_late, reason_code, source')
          .eq('assignment_id', asignacion)
          .order('created_at')
        expect(avisos).toEqual([
          {
            kind: 'delay',
            minutes_late: 15,
            reason_code: null,
            source: 'employee_app',
          },
          {
            kind: 'absence',
            minutes_late: null,
            reason_code: 'illness',
            source: 'employee_app',
          },
        ])
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'desde Más, una ausencia con motivo "Otro" exige el texto; Hoy ofrece el atajo mientras haya algo por avisar',
  cubre('RB-E07', 'P-073'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('avisos-otro')
      const sede = await sc.site(cliente.id, 'avisos-otro')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        daysFromToday(2),
        FRANJAS.manana,
      )
      const asignacion = await sc.assign(turno, 'empleado1')
      await marcarCambiosVistos('empleado1')

      await test.step('Hoy ofrece el atajo y lleva al selector de servicio', async () => {
        await page.goto('/app')
        await page
          .getByRole('link', { name: 'Avisar demora o ausencia' })
          .click()
        await expect(page).toHaveURL(/\/app\/avisar$/)
      })

      await test.step('Más también lleva a EMP-12', async () => {
        await page.goto('/app/mas')
        await page
          .getByRole('link', { name: 'Avisar demora o ausencia' })
          .click()
        await expect(page).toHaveURL(/\/app\/avisar$/)
        await expect(
          page.getByText('Elegí el servicio sobre el que querés avisar.'),
        ).toBeVisible()
      })

      await test.step('selector: sin elegir no se continúa; con el servicio, ausencia por "Otro"', async () => {
        await expect(
          page.getByRole('button', { name: 'Continuar' }),
        ).toBeDisabled()
        await page
          .getByRole('radio', {
            name: new RegExp(`${cliente.name}.*${sede.name}`),
          })
          .click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await page.getByRole('radio', { name: 'Ausencia' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await page.getByRole('radio', { name: 'Otro' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(page.getByText('Contanos el motivo.')).toBeVisible()
        await page
          .getByPlaceholder('Contanos el motivo…')
          .fill('e2e: mudanza imprevista')
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(page.getByText('Vas a avisar que no vas.')).toBeVisible()
        await page.getByRole('button', { name: 'Confirmar aviso' }).click()
        await expect(page.getByText('Avisaste que no vas.')).toBeVisible()
      })

      await test.step('el detalle cita el motivo escrito', async () => {
        await page.goto(`/app/servicio/${asignacion}`)
        await expect(
          page.getByText('Avisaste que no vas: "e2e: mudanza imprevista".'),
        ).toBeVisible()
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'un aviso sobre un servicio cuya hora de inicio ya pasó se rechaza con un mensaje claro (RB-E07)',
  cubre('RB-E07', 'CB-06', 'P-072', 'P-073'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('avisos-tarde')
      const sede = await sc.site(cliente.id, 'avisos-tarde')
      // 00:00–00:01: la hora de inicio ya pasó a cualquier hora del día, sin registro de inicio.
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS.madrugada,
      )
      const asignacion = await sc.assign(turno, 'empleado1')
      await marcarCambiosVistos('empleado1')

      await test.step('por la pantalla: el servidor rechaza y la pantalla muestra el mensaje', async () => {
        await page.goto(`/app/avisar?asignacion=${asignacion}`)
        await page.getByRole('radio', { name: 'Demora' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await page.getByRole('button', { name: 'Confirmar aviso' }).click()
        await expect(page.getByText(TEXTO.avisoTarde)).toBeVisible()
      })

      await test.step('por la API, la ausencia propia también (TOO_LATE_TO_NOTIFY)', async () => {
        const api = await sessionClient('empleado1')
        expectHint(
          await api.rpc('notify_absence', {
            p_assignment_id: asignacion,
            p_reason_code: 'illness',
          }),
          'TOO_LATE_TO_NOTIFY',
        )
      })

      await test.step('no quedó ningún aviso ni cambió el estado', async () => {
        const { data: avisos } = await sc.db
          .from('attendance_notices')
          .select('id')
          .eq('assignment_id', asignacion)
        expect(avisos).toHaveLength(0)
        const { data: a } = await sc.db
          .from('assignments')
          .select('status')
          .eq('id', asignacion)
          .single()
        expect(a?.status).toBe('expected')
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'CB-06: un aviso en el último minuto antes de la hora de inicio se acepta; pasada la hora, se rechaza',
  cubre('CB-06', 'RB-E07', 'P-072', 'P-073'),
  async ({ page, browser }, testInfo) => {
    test.setTimeout(420_000)
    // La hora de inicio se arma a 3 minutos de ahora (hay que dejar tiempo para llegar a la
    // pantalla de confirmación y esperar el borde); sin lugar en el día, se saltea.
    const arranque = minutosAhora() + 3
    test.skip(
      arranque + 5 > 23 * 60 + 50,
      'Faltan menos de 12 minutos para la medianoche de Argentina: no hay margen para armar un turno que empiece en 3 minutos.',
    )
    const sc = new Scenario()
    const contextoDos = await contextoDe(browser, testInfo, 'empleado2')
    try {
      const cliente = await sc.client('cb06')
      const sede = await sc.site(cliente.id, 'cb06')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        { start: hhmm(arranque), end: hhmm(arranque + 5) },
        2,
      )
      const asignacionUno = await sc.assign(turno, 'empleado1')
      const asignacionDos = await sc.assign(turno, 'empleado2')
      await marcarCambiosVistos('empleado1')
      await marcarCambiosVistos('empleado2')
      const paginaDos = await contextoDos.newPage()

      // Las dos personas llegan a "Confirmar aviso" ANTES de la hora; confirman en momentos
      // distintos: la uno dentro del último minuto (hora:59), la dos pasada la hora de inicio.
      await prepararAusencia(page, asignacionUno)
      await prepararAusencia(paginaDos, asignacionDos)

      await test.step('dentro del último minuto antes de la hora de inicio: aceptado', async () => {
        await esperarHastaSegundo((arranque - 1) * 60, 8)
        await page.getByRole('button', { name: 'Confirmar aviso' }).click()
        await expect(page.getByText('Avisaste que no vas.')).toBeVisible()
      })

      await test.step('pasada la hora de inicio: rechazado con TOO_LATE_TO_NOTIFY', async () => {
        await esperarHastaSegundo(arranque * 60, 3)
        await paginaDos.getByRole('button', { name: 'Confirmar aviso' }).click()
        await expect(paginaDos.getByText(TEXTO.avisoTarde)).toBeVisible()
      })

      await test.step('en la Base: solo el primero quedó con aviso', async () => {
        const { data: a1 } = await sc.db
          .from('assignments')
          .select('status')
          .eq('id', asignacionUno)
          .single()
        expect(a1?.status).toBe('absence_notified')
        const { data: a2 } = await sc.db
          .from('assignments')
          .select('status')
          .eq('id', asignacionDos)
          .single()
        expect(a2?.status).toBe('expected')
      })

      await test.step('Hoy muestra el aviso vigente en la tarjeta del primero (ABS-005)', async () => {
        await page.goto('/app')
        await expect(
          page.getByText('Avisaste que no vas: enfermedad.'),
        ).toBeVisible()
      })
    } finally {
      await contextoDos.close()
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
