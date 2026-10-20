import { expect, test } from '@playwright/test'
import { reNombreDe } from '../fixtures/accounts.ts'
import { daysFromToday, FRANJAS } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { marcarCambiosVistos } from '../fixtures/movil.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'

// P19.11g · Ausencia avisada por el empleado desde el celular (0059: el empleado no indica
// certificado). Administración la ve como «Ausente · certificado sin indicar» con la acción
// «Marcar certificado» (`set_absence_certificate`, 0060) y la completa.
// Turnos de pasado mañana (todavía no empezaron, el aviso se acepta a cualquier hora de hoy).
// Cuentas: empleado1 (celular) y admin (en un contexto de escritorio).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('empleado1') })

test(
  'el empleado avisa su ausencia desde el celular: administración ve «certificado sin indicar» y marca el certificado',
  cubre('RB-E07', 'RB-A06', 'RB-A08', 'P-073'),
  async ({ page, browser }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('p1911-aviso')
      const sede = await sc.site(cliente.id, 'p1911-aviso')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        daysFromToday(2),
        FRANJAS.manana,
      )
      const asignacion = await sc.assign(turno, 'empleado1')
      await marcarCambiosVistos('empleado1')

      await test.step('EMP-12: el empleado avisa que no va, por enfermedad, sin elegir certificado', async () => {
        await page.goto(`/app/avisar?asignacion=${asignacion}`)
        await page.getByRole('radio', { name: 'Ausencia' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        // El empleado no tiene que indicar certificado (0059): la pantalla no lo pregunta.
        await expect(page.getByText(/certificado/i)).toHaveCount(0)
        await page.getByRole('radio', { name: 'Enfermedad' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(
          page.getByText('Vas a avisar que no vas: enfermedad.'),
        ).toBeVisible()
        await expect(page.getByText(/certificado/i)).toHaveCount(0)
        await page.getByRole('button', { name: 'Confirmar aviso' }).click()
        await expect(page.getByText('Avisaste que no vas.')).toBeVisible()
      })

      await test.step('el aviso del empleado quedó sin certificado indicado', async () => {
        const { data, error } = await sc.db
          .from('attendance_notices')
          .select('kind, has_certificate, source')
          .eq('assignment_id', asignacion)
          .is('voided_at', null)
        expect(error, error?.message).toBeNull()
        expect(data).toEqual([
          { kind: 'absence', has_certificate: null, source: 'employee_app' },
        ])
      })

      await test.step('si el empleado manda un certificado por API, el servidor lo ignora', async () => {
        const turno2 = await sc.shift(
          cliente.id,
          sede.id,
          daysFromToday(3),
          FRANJAS.manana,
        )
        const asignacion2 = await sc.assign(turno2, 'empleado1')
        const empleado = await sessionClient('empleado1')
        const { error } = await empleado.rpc('notify_absence', {
          p_assignment_id: asignacion2,
          p_reason_code: 'illness',
          p_has_certificate: true,
        })
        expect(error, error?.message).toBeNull()
        const { data } = await sc.db
          .from('attendance_notices')
          .select('has_certificate')
          .eq('assignment_id', asignacion2)
          .single()
        expect(data?.has_certificate).toBeNull()
      })

      const contextoAdmin = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        viewport: { width: 1280, height: 900 },
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires',
        storageState: storageStatePath('admin'),
      })
      try {
        const admin = await contextoAdmin.newPage()
        await admin.goto(`/admin/turnos/${turno}`)
        const detalle = admin.getByRole('dialog', { name: 'Detalle del turno' })

        await test.step('administración ve «Ausente · certificado sin indicar» y «Marcar certificado»', async () => {
          await expect(
            detalle.getByText('Ausente · certificado sin indicar'),
          ).toBeVisible()
          await expect(
            detalle.getByRole('button', { name: 'Marcar certificado' }),
          ).toBeVisible()
          // Hay ausencia avisada: no se ofrece «Ausente» ni «Cambiar».
          await expect(
            detalle.getByRole('button', { name: 'Ausente', exact: true }),
          ).toHaveCount(0)
          await expect(
            detalle.getByRole('button', { name: 'Cambiar' }),
          ).toHaveCount(0)
        })

        await test.step('marca «Con certificado» y queda registrado quién lo hizo', async () => {
          await detalle
            .getByRole('button', { name: 'Marcar certificado' })
            .click()
          const popup = admin.getByRole('dialog', {
            name: new RegExp(
              `^Certificado de la ausencia de ${reNombreDe('empleado1').source}`,
            ),
          })
          // Sin elegir nada, no guarda.
          await popup.getByRole('button', { name: 'Guardar' }).click()
          await expect(
            popup.getByText('Indicá si la ausencia tiene certificado.'),
          ).toBeVisible()
          await popup.getByRole('radio', { name: 'Con certificado' }).click()
          await popup.getByRole('button', { name: 'Guardar' }).click()
          await expect(
            detalle.getByText('Ausente · con certificado'),
          ).toBeVisible()
          const { data } = await sc.db
            .from('attendance_notices')
            .select('has_certificate, updated_by, source')
            .eq('assignment_id', asignacion)
            .single()
          expect(data).toMatchObject({
            has_certificate: true,
            updated_by: readId('admin'),
            source: 'employee_app',
          })
        })
      } finally {
        await contextoAdmin.close()
      }
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
