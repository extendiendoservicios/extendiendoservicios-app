import { expect, test, type Page } from '@playwright/test'
import { FIXED_ACCOUNTS, nombreDe } from '../../fixtures/accounts.ts'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  FRANJAS_MOVIL,
  fijarConsentimiento,
  POSICION_SIMULADA,
  TEXTO,
} from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import {
  anonClient,
  readId,
  signInSession,
  storageStatePath,
} from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll, loginByForm } from '../../fixtures/ui.ts'

// TEST-018 (P18.2): el flujo del supervisor en la sede (SUP-03 a SUP-06 y SUP-08): registrar
// inicio y fin (SUP-04) con la geoposición concedida y negada, calificar con estrellas y
// comentario (SUP-05), editar la calificación, cerrar con faltantes, "No se pudo realizar" y el
// historial (RB-S01, RB-S04, RB-S05, CB-21, P-041, P-067, P-080, P-081, P-082, P-083, P-085,
// P-091). Cuentas: supervisor1 con la ubicación concedida; supervisor2 con la ubicación negada;
// empleado1 y empleado2 son los empleados de los turnos.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

/** Fila de "Empleados a supervisar" (SUP-03) con el nombre dado. */
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
    'inicio y fin con ubicación, calificar, editar, cerrar con faltantes, "no se pudo realizar" e historial',
    cubre(
      'RB-S01',
      'RB-S04',
      'RB-S05',
      'P-041',
      'P-080',
      'P-082',
      'P-083',
      'P-085',
    ),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('sup-flujo')
        const sede = await sc.site(cliente.id, 'sup-flujo')
        // Todo el día: la ventana para calificar (P-083) sigue abierta hasta las 23:59.
        const turnoA = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
          2,
        )
        const asignacionUno = await sc.assign(turnoA, 'empleado1')
        await sc.assign(turnoA, 'empleado2')
        const supA = await sc.assignSupervision(turnoA, 'supervisor1')
        // B: la noche, sin empleados; se cierra como "no realizada".
        const sedeB = await sc.site(cliente.id, 'sup-flujo-b')
        const turnoB = await sc.shift(
          cliente.id,
          sedeB.id,
          sc.today,
          FRANJAS.noche,
        )
        const supB = await sc.assignSupervision(turnoB, 'supervisor1')
        await fijarConsentimiento('supervisor1', false)

        await test.step('SUP-02 → SUP-03: desde Hoy se entra al detalle', async () => {
          await page.goto('/sup')
          await page.getByRole('link').filter({ hasText: sede.name }).click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${supA}$`),
          )
          await expect(
            page.getByRole('link', { name: 'Registrar inicio de supervisión' }),
          ).toBeVisible()
        })

        await test.step('SUP-04: consentimiento de ubicación y registro del inicio', async () => {
          await page
            .getByRole('link', { name: 'Registrar inicio de supervisión' })
            .click()
          await expect(page.getByText('Tu ubicación al fichar')).toBeVisible()
          await page
            .getByRole('button', { name: 'Aceptar y continuar' })
            .click()
          await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
          await page.getByRole('button', { name: 'Registrar inicio' }).click()
          await expect(
            page.getByText(/Supervisión iniciada a las/),
          ).toBeVisible()
        })

        await test.step('SUP-04: "Registrar fin" vuelve al detalle con las dos horas', async () => {
          await page.getByRole('button', { name: 'Registrar fin' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${supA}$`),
          )
          await expect(page.getByText(/Finalizada a las/)).toBeVisible()
          await expect(
            page.getByRole('link', { name: /Registrar (inicio|fin)/ }),
            'con los dos registros ya no se ofrece registrar',
          ).toHaveCount(0)
        })

        await test.step('en la Base: inicio y fin con latitud, longitud y precisión', async () => {
          const { data } = await sc.db
            .from('supervision_attendance')
            .select('kind, latitude, longitude, accuracy_m')
            .eq('supervision_id', supA)
          expect(data).toHaveLength(2)
          for (const r of data ?? []) {
            expect(r.latitude, r.kind).not.toBeNull()
            expect(r.longitude, r.kind).not.toBeNull()
            expect(r.accuracy_m, r.kind).not.toBeNull()
          }
        })

        await test.step('SUP-05: calificar a un empleado con estrellas y comentario', async () => {
          await filaDe(page, nombreDe('empleado1'))
            .getByRole('link', { name: 'Calificar' })
            .click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${supA}/calificar/`),
          )
          await page.getByRole('radio', { name: '4 de 5 estrellas' }).click()
          await page
            .getByPlaceholder('Comentario (opcional)…')
            .fill('e2e-flujo: cumplió con todo lo pedido.')
          await page
            .getByRole('button', { name: 'Guardar calificación' })
            .click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${supA}$`),
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
            .eq('supervision_id', supA)
          expect(data).toEqual([
            {
              score: 5,
              comment: 'e2e-flujo: cumplió con todo lo pedido.',
              assignment_id: asignacionUno,
            },
          ])
        })

        await test.step('SUP-06: cerrar con un empleado sin calificar es una advertencia, no un bloqueo', async () => {
          await page.getByRole('link', { name: 'Cerrar supervisión' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/sup/supervisiones/${supA}/cerrar`),
          )
          await expect(page.getByText('Calificaste a 1 de 2')).toBeVisible()
          await expect(
            page.getByText('Falta 1 empleado por calificar'),
          ).toBeVisible()
          await page
            .getByPlaceholder('Nota general (opcional)…')
            .fill('e2e-flujo: nota general')
          await page
            .getByRole('button', { name: 'Completar supervisión' })
            .click()
          await expect(page).toHaveURL(/\/sup$/)
          const { data } = await sc.db
            .from('supervisions')
            .select('status')
            .eq('id', supA)
            .single()
          expect(data?.status).toBe('completed')
        })

        await test.step('SUP-06: "No se pudo realizar" pide el motivo y no exige el fin', async () => {
          await page.goto('/sup/supervisiones')
          await page.getByRole('link').filter({ hasText: sedeB.name }).click()
          await page.getByRole('link', { name: 'Cerrar supervisión' }).click()
          await expect(
            page.getByText('Contá por qué no se pudo realizar la supervisión.'),
          ).toBeVisible()
          await page
            .getByRole('button', { name: 'Marcar como no realizada' })
            .click()
          await expect(page.getByText('Indicá el motivo.')).toBeVisible()
          await page
            .getByPlaceholder('Motivo…')
            .fill('e2e-flujo: la sede estaba cerrada por refacciones.')
          await page
            .getByRole('button', { name: 'Marcar como no realizada' })
            .click()
          await expect(page).toHaveURL(/\/sup$/)
          const { data } = await sc.db
            .from('supervisions')
            .select('status, not_done_reason')
            .eq('id', supB)
            .single()
          expect(data).toEqual({
            status: 'not_done',
            not_done_reason:
              'e2e-flujo: la sede estaba cerrada por refacciones.',
          })
        })

        await test.step('SUP-08: el historial las muestra, con puntaje y con motivo', async () => {
          await page
            .getByRole('navigation')
            .getByRole('link', { name: 'Historial' })
            .click()
          await expect(page).toHaveURL(/\/sup\/historial$/)
          await expect(
            page.getByRole('link').filter({ hasText: sede.name }),
          ).toContainText('1 de 2 calificados')
          await expect(
            page.getByText(
              'Motivo: e2e-flujo: la sede estaba cerrada por refacciones.',
            ),
          ).toBeVisible()
          await expectNoHorizontalScroll(page)
        })
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
    'acepta el consentimiento pero el navegador niega el permiso: inicio y fin se registran sin coordenadas',
    cubre('RB-S01', 'CB-21', 'P-067', 'P-091'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('sup-sin-geo')
        const sede = await sc.site(cliente.id, 'sup-sin-geo')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        const sup = await sc.assignSupervision(turno, 'supervisor2')
        await fijarConsentimiento('supervisor2', false)

        await page.goto(`/sup/supervisiones/${sup}/registro`)
        await page.getByRole('button', { name: 'Aceptar y continuar' }).click()
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page.getByText(/Supervisión iniciada a las/)).toBeVisible()
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(page).toHaveURL(new RegExp(`/sup/supervisiones/${sup}$`))

        const { data } = await sc.db
          .from('supervision_attendance')
          .select('kind, latitude, longitude')
          .eq('supervision_id', sup)
        expect(data).toHaveLength(2)
        for (const r of data ?? []) {
          expect(r.latitude, r.kind).toBeNull()
          expect(r.longitude, r.kind).toBeNull()
        }
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'rechaza el consentimiento ("Continuar sin ubicación"): registra igual y no queda consentimiento dado',
    cubre('RB-S01', 'CB-21', 'P-091'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('sup-rechaza')
        const sede = await sc.site(cliente.id, 'sup-rechaza')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        const sup = await sc.assignSupervision(turno, 'supervisor2')
        await fijarConsentimiento('supervisor2', false)

        await page.goto(`/sup/supervisiones/${sup}/registro`)
        await page
          .getByRole('button', { name: 'Continuar sin ubicación' })
          .click()
        await expect(page.getByText(TEXTO.horaReferencia)).toBeVisible()
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page.getByText(/Supervisión iniciada a las/)).toBeVisible()

        const { data } = await sc.db
          .from('supervision_attendance')
          .select('latitude, longitude')
          .eq('supervision_id', sup)
        expect(data).toHaveLength(1)
        expect(data![0].latitude).toBeNull()
        expect(data![0].longitude).toBeNull()
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
      await expect(page.getByText('Supervisor', { exact: true })).toBeVisible()
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
