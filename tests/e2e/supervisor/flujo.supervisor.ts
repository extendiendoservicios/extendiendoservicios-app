import { expect, test, type Page } from '@playwright/test'
import { FIXED_ACCOUNTS, nombreDe } from '../../fixtures/accounts.ts'
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
} from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import {
  anonClient,
  signInSession,
  storageStatePath,
} from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll, loginByForm } from '../../fixtures/ui.ts'

// TEST-018 (P18.2), reescrito en P24.5: el flujo del coordinador en la sede (SUP-04, SUP-05) y Más
// (SUP-09): calificar con estrellas y comentario, editar la calificación dentro de la ventana de
// P-083 y cerrar (RB-S01, RB-S04, RB-S05, P-080, P-081, P-082, P-083, P-085). El inicio y el fin
// de la jornada y de la supervisión (con la ubicación concedida y negada) están en
// `jornada.supervisor.ts`; dos coordinadores en un turno y el orden de «Hoy», en
// `coordinacion.supervisor.ts`. Cuentas: supervisor1 (ubicación concedida) y supervisor2;
// empleado1 y empleado2 son los empleados del turno.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

/** Fila de "Empleados a supervisar" (SUP-04) con el nombre dado. */
function filaDe(page: Page, nombre: string) {
  return page
    .locator('div.flex.items-center.justify-between.gap-2')
    .filter({ hasText: nombre })
}

test.describe('con la geoposición concedida', () => {
  test.use({
    storageState: storageStatePath('supervisor1'),
    geolocation: POSICION_SIMULADA,
    permissions: ['geolocation'],
  })

  test(
    'calificar con estrellas y comentario, editar dentro del plazo y cerrar con la nota general',
    cubre(
      'RB-S01',
      'RB-S04',
      'RB-S05',
      'P-080',
      'P-082',
      'P-083',
      'P-085',
      'CJ-10',
    ),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('sup-flujo')
        const sede = await sc.site(cliente.id, 'sup-flujo')
        // Todo el día: la ventana para calificar (P-083) sigue abierta hasta las 23:59.
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
        await fijarConsentimiento('supervisor1', true)
        const supervision = await sc.tomarSupervision(turno, 'supervisor1')

        await test.step('SUP-07 → SUP-04: la supervisión abierta lleva a su detalle', async () => {
          await page.goto('/sup/supervisiones')
          await page.getByRole('link').filter({ hasText: sede.name }).click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${supervision}$`),
          )
          await expect(page.getByText(/Iniciada a las/)).toBeVisible()
        })

        await test.step('SUP-05: calificar a un empleado con estrellas y comentario', async () => {
          await filaDe(page, nombreDe('empleado1'))
            .getByRole('link', { name: 'Calificar' })
            .click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${supervision}/calificar/`),
          )
          await page.getByRole('radio', { name: '4 de 5 estrellas' }).click()
          await page
            .getByPlaceholder('Comentario (opcional)…')
            .fill('e2e-flujo: cumplió con todo lo pedido.')
          await page
            .getByRole('button', { name: 'Guardar calificación' })
            .click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${supervision}$`),
          )
          await expect(
            filaDe(page, nombreDe('empleado1')).getByRole('link', {
              name: 'Editar',
            }),
          ).toBeVisible()
        })

        await test.step('P-083: se edita dentro de la ventana y queda el último puntaje', async () => {
          await filaDe(page, nombreDe('empleado1'))
            .getByRole('link', { name: 'Editar' })
            .click()
          await expect(
            page.getByRole('radio', {
              name: '4 de 5 estrellas',
              checked: true,
            }),
          ).toBeVisible()
          await page.getByRole('radio', { name: '5 de 5 estrellas' }).click()
          await page
            .getByRole('button', { name: 'Guardar calificación' })
            .click()
          await expect(
            filaDe(page, nombreDe('empleado1')).getByRole('img', {
              name: '5 de 5 estrellas',
            }),
          ).toBeVisible()
          const { data } = await sc.db
            .from('ratings')
            .select('score, comment, assignment_id')
            .eq('supervision_id', supervision)
          expect(data).toEqual([
            {
              score: 5,
              comment: 'e2e-flujo: cumplió con todo lo pedido.',
              assignment_id: asignacionUno,
            },
          ])
        })

        await test.step('CJ-10, SUP-06: cerrar con un empleado sin calificar está bloqueado y dice a quién falta', async () => {
          await page.goto(`/sup/supervisiones/${supervision}/cerrar`)
          await expect(page.getByText('Calificaste a 1 de 2')).toBeVisible()
          await expect(
            page.getByText('Para cerrar tenés que calificar a todos'),
          ).toBeVisible()
          await expect(
            page.getByRole('link', { name: nombreDe('empleado2') }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: 'Cerrar supervisión' }),
          ).toBeDisabled()
        })

        await test.step('al calificar al que faltaba se cierra con la nota general', async () => {
          await page.getByRole('link', { name: nombreDe('empleado2') }).click()
          await page.getByRole('radio', { name: '3 de 5 estrellas' }).click()
          await page
            .getByRole('button', { name: 'Guardar calificación' })
            .click()
          await page.goto(`/sup/supervisiones/${supervision}/cerrar`)
          await expect(page.getByText('Calificaste a 2 de 2')).toBeVisible()
          await page
            .getByPlaceholder('Nota general (opcional)…')
            .fill('e2e-flujo: nota general')
          await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
          await expect(page).toHaveURL(/\/sup$/)
          const { data } = await sc.db
            .from('supervisions')
            .select('status, general_notes')
            .eq('id', supervision)
            .single()
          expect(data).toEqual({
            status: 'completed',
            general_notes: 'e2e-flujo: nota general',
          })
        })

        await test.step('SUP-08: el historial muestra la jornada con su supervisión', async () => {
          await page
            .getByRole('navigation')
            .getByRole('link', { name: 'Historial' })
            .click()
          await expect(page).toHaveURL(/\/sup\/historial$/)
          await expect(
            page.getByRole('link').filter({ hasText: sede.name }),
          ).toBeVisible()
          await expectNoHorizontalScroll(page)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('Más y cerrar sesión', () => {
  test.use({ storageState: storageStatePath('supervisor2'), permissions: [] })

  test(
    'SUP-09 Más: perfil y cerrar sesión; sin el rol de empleado no hay "Mis servicios"',
    cubre('RB-S01', 'P-122'),
    async ({ page }) => {
      await page.goto('/sup')
      const tabbar = page.getByRole('navigation', {
        name: 'Navegación principal',
      })
      for (const etiqueta of ['Hoy', 'Supervisiones', 'Historial', 'Más']) {
        await expect(tabbar.getByRole('link', { name: etiqueta })).toBeVisible()
      }
      await tabbar.getByRole('link', { name: 'Más' }).click()
      await expect(page).toHaveURL(/\/sup\/mas$/)
      await expect(page.getByRole('link', { name: 'Mi perfil' })).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Cerrar sesión' }),
      ).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Mis servicios' }),
      ).toHaveCount(0)
      await expectNoHorizontalScroll(page)
      await page.getByRole('link', { name: 'Mi perfil' }).click()
      await expect(page).toHaveURL(/\/perfil$/)
      await expect(page.getByText('Coordinador', { exact: true })).toBeVisible()
    },
  )
})

test.describe('cerrar sesión', () => {
  // Ingreso propio por COM-01: la sesión que se cierra no es la de `storageState`.
  test.use({ storageState: { cookies: [], origins: [] }, permissions: [] })

  test(
    'SUP-09 Cerrar sesión lleva a COM-01 y la ruta del supervisor ya no abre; la otra sesión de la cuenta sigue viva (DEF-04)',
    cubre('RB-S01', 'RB-X02', 'P-015', 'P-122'),
    async ({ page }) => {
      const cuenta = FIXED_ACCOUNTS.supervisor2.email
      const otroDispositivo = await signInSession(cuenta)
      await loginByForm(page, cuenta, /\/sup/)
      await page
        .getByRole('navigation', { name: 'Navegación principal' })
        .getByRole('link', { name: 'Más' })
        .click()
      await page.getByRole('button', { name: 'Cerrar sesión' }).click()
      await expect(page).toHaveURL(/\/ingresar/)
      await page.goto('/sup')
      await expect(page).toHaveURL(/\/ingresar/)

      const renovada = await anonClient().auth.refreshSession({
        refresh_token: otroDispositivo.refresh_token,
      })
      expect(
        renovada.error,
        'la sesión del otro dispositivo sigue válida (cierre local)',
      ).toBeNull()
    },
  )
})
