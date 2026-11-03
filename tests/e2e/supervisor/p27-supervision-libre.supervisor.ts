import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  fichar,
  fijarConsentimiento,
  FRANJAS_MOVIL,
  POSICION_SIMULADA,
  tarjetaDeTurno,
} from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P27.8 (OD-08, OD-09, OD-10; cambian CJ-10, CJ-27 y CJ-28): el coordinador, a 390 px y con la
// geolocalización simulada, inicia su jornada, supervisa un turno que todavía no empezó (el
// empleado no llegó), cierra sin calificar a todos con el diálogo «Cerrar igual» y vuelve más
// tarde al mismo turno con «Supervisar de nuevo» para calificar. Cuenta: supervisor1; empleados:
// empleado1 (turno que no empezó, sin fichaje) y empleado2 (turno de todo el día, ya fichó).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({
  storageState: storageStatePath('supervisor1'),
  geolocation: POSICION_SIMULADA,
  permissions: ['geolocation'],
})

function barra(page: Page) {
  return page.getByTestId('workday-bar')
}

function filaDe(page: Page, nombre: string) {
  return page
    .locator('div.flex.items-center.justify-between.gap-2')
    .filter({ hasText: nombre })
}

/** «Supervisar» (o «Supervisar de nuevo») hasta quedar dentro de la supervisión nueva. */
async function supervisar(page: Page, boton: string): Promise<string> {
  await page.getByRole('button', { name: boton, exact: true }).click()
  await expect(page.getByTestId('attendance-result')).toBeVisible()
  await page
    .getByTestId('attendance-result')
    .getByRole('button', { name: 'Seguir con la supervisión' })
    .click()
  await expect(page).toHaveURL(/\/sup\/supervisiones\/[0-9a-f-]{36}$/)
  return page.url().split('/').pop()!
}

test(
  'supervisar un turno que no empezó, cerrar sin calificar con «Cerrar igual» y volver con «Supervisar de nuevo» para calificar',
  cubre(
    'RB-S01',
    'RB-S04',
    'RB-S05',
    'OD-08',
    'OD-09',
    'OD-10',
    'CJ-07',
    'CJ-08',
  ),
  async ({ page }) => {
    test.setTimeout(300_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('p27-sup')
      const sedeSinEmpezar = await sc.site(cliente.id, 'p27-no-empezo')
      const sedeDiaCompleto = await sc.site(cliente.id, 'p27-dia')
      // Turno por empezar: 23:50–23:59 (a cualquier hora salvo la última franja del día).
      const turnoSinEmpezar = await sc.shift(
        cliente.id,
        sedeSinEmpezar.id,
        sc.today,
        FRANJAS_MOVIL.finDia,
      )
      const turnoDia = await sc.shift(
        cliente.id,
        sedeDiaCompleto.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      await sc.assign(turnoSinEmpezar, 'empleado1')
      const asignacionDos = await sc.assign(turnoDia, 'empleado2')
      await fijarConsentimiento('empleado2', true)
      await fichar('empleado2', asignacionDos, 'inicio')
      await sc.tomarCoordinador('supervisor1')
      await fijarConsentimiento('supervisor1', true)

      await test.step('CJ-07: sin jornada iniciada no se supervisa; «Iniciar jornada» la deja en actividad', async () => {
        await page.goto('/sup')
        await expect(barra(page)).toContainText('Sin iniciar')
        await barra(page)
          .getByRole('button', { name: 'Iniciar jornada' })
          .click()
        await expect(barra(page)).toContainText('En actividad')
      })

      let primera = ''
      await test.step('OD-08: se supervisa un turno que todavía no empezó, aunque el empleado no haya llegado', async () => {
        await tarjetaDeTurno(page, sedeSinEmpezar.name).click()
        await expect(
          page.getByRole('button', { name: 'Supervisar', exact: true }),
        ).toBeEnabled()
        primera = await supervisar(page, 'Supervisar')
        const { data: asignacion } = await sc.db
          .from('assignments')
          .select('status')
          .eq('shift_id', turnoSinEmpezar)
          .single()
        expect(asignacion?.status, 'el empleado no llegó').toBe('expected')
        const { data } = await sc.db
          .from('supervisions')
          .select('status')
          .eq('id', primera)
          .single()
        expect(data?.status).toBe('in_progress')
      })

      await test.step('OD-09: sin nadie para calificar, se cierra directo', async () => {
        await page.getByRole('link', { name: 'Cerrar supervisión' }).click()
        await expect(page.getByText('Te falta calificar a:')).toHaveCount(0)
        await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
        await expect(page).toHaveURL(/\/sup$/)
        const { data } = await sc.db
          .from('supervisions')
          .select('status')
          .eq('id', primera)
          .single()
        expect(data?.status).toBe('completed')
      })

      let segunda = ''
      await test.step('OD-09: con un empleado sin calificar, «Cerrar supervisión» avisa a quién falta y pide confirmar', async () => {
        await tarjetaDeTurno(page, sedeDiaCompleto.name).click()
        segunda = await supervisar(page, 'Supervisar')
        await page.getByRole('link', { name: 'Cerrar supervisión' }).click()
        await expect(page.getByText('Te falta calificar a:')).toBeVisible()
        await expect(
          page.getByRole('link', { name: nombreDe('empleado2') }),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
        const dialogo = page.getByRole('dialog')
        await expect(
          dialogo.getByRole('heading', {
            name: '¿Cerrar sin calificar a todos?',
          }),
        ).toBeVisible()
        await expect(dialogo).toContainText(nombreDe('empleado2'))
        await expect(dialogo).toContainText('volvé a supervisar el turno')
        await dialogo.getByRole('button', { name: 'Cerrar igual' }).click()
        await expect(page).toHaveURL(/\/sup$/)
        const { data: sup } = await sc.db
          .from('supervisions')
          .select('status')
          .eq('id', segunda)
          .single()
        expect(sup?.status, 'se cerró sin calificar').toBe('completed')
        const { data: notas } = await sc.db
          .from('ratings')
          .select('id')
          .eq('supervision_id', segunda)
        expect(notas, 'sin calificaciones').toHaveLength(0)
      })

      let tercera = ''
      await test.step('OD-10: el mismo turno se puede volver a supervisar; la pasada anterior queda registrada', async () => {
        await tarjetaDeTurno(page, sedeDiaCompleto.name).click()
        await expect(
          page.getByText('Tus supervisiones de este turno'),
        ).toBeVisible()
        tercera = await supervisar(page, 'Supervisar de nuevo')
        expect(tercera).not.toBe(segunda)
        const { data } = await sc.db
          .from('supervisions')
          .select('id, status')
          .eq('shift_id', turnoDia)
          .order('created_at')
        expect(data?.map((s) => s.status)).toEqual(['completed', 'in_progress'])
        expect(data?.map((s) => s.id)).toEqual([segunda, tercera])
      })

      await test.step('OD-10: en la pasada nueva se califica y se cierra sin diálogo', async () => {
        await filaDe(page, nombreDe('empleado2'))
          .getByRole('link', { name: 'Calificar' })
          .click()
        await page.getByRole('radio', { name: '5 de 5 estrellas' }).click()
        await page.getByRole('button', { name: 'Guardar calificación' }).click()
        await page.getByRole('link', { name: 'Cerrar supervisión' }).click()
        await expect(page.getByText('Calificaste a 1 de 1')).toBeVisible()
        await expect(page.getByText('Te falta calificar a:')).toHaveCount(0)
        await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
        await expect(page).toHaveURL(/\/sup$/)
        const { data: notas } = await sc.db
          .from('ratings')
          .select('score, supervision_id')
          .eq('supervision_id', tercera)
        expect(notas).toEqual([{ score: 5, supervision_id: tercera }])
        await expectNoHorizontalScroll(page)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
