import { expect, test, type Page } from '@playwright/test'
import { nombreDe, reNombreDe } from '../fixtures/accounts.ts'
import { expectHint } from '../fixtures/api.ts'
import { daysFromToday, FRANJAS } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'

// P19.11g · «Ausente» con certificado (0059, 0060 y P19.11d, punto 1 de la reunión del 19 oct).
//   - ADM-06: botón «Ausente» → popup con «Con certificado» / «Sin certificado» obligatorio y motivo
//     opcional; el estado queda «Ausente · con/sin certificado» con la acción «Cambiar».
//   - Sin elegir certificado: error de validación y no se crea el aviso (el servidor también lo
//     rechaza con CERTIFICATE_REQUIRED).
//   - «Cambiar» (set_absence_certificate) pasa de con a sin certificado y registra quién lo cambió.
//   - El certificado se ve en «Asistencia de hoy».
// Turnos futuros (mañana y pasado), recortados al día. Cuentas: admin y empleado1 a empleado3.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

/** Un turno futuro con una persona asignada; devuelve ids y nombre del cliente. */
async function armar(
  sc: Scenario,
  quien: 'empleado1' | 'empleado2' | 'empleado3',
  dias: number,
) {
  const cliente = await sc.client('p1911-ausente')
  const sede = await sc.site(cliente.id, 'p1911-ausente')
  const turno = await sc.shift(
    cliente.id,
    sede.id,
    daysFromToday(dias),
    FRANJAS.manana,
  )
  const asignacion = await sc.assign(turno, quien)
  return { cliente, sede, turno, asignacion }
}

async function abrirDetalle(page: Page, turno: string) {
  await page.goto(`/admin/turnos/${turno}`)
  const detalle = page.getByRole('dialog', { name: 'Detalle del turno' })
  await expect(detalle).toBeVisible()
  return detalle
}

async function avisosDe(sc: Scenario, asignacion: string) {
  const { data, error } = await sc.db
    .from('attendance_notices')
    .select('kind, has_certificate, reason_code, updated_by, source')
    .eq('assignment_id', asignacion)
    .is('voided_at', null)
  expect(error, error?.message).toBeNull()
  return data ?? []
}

test.describe('Ausente con certificado (ADM-06)', () => {
  test(
    'marcar ausente «Con certificado» deja el estado «Ausente · con certificado» y el aviso en la base',
    cubre('RB-A06', 'RB-A08', 'P-073'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const { turno, asignacion } = await armar(sc, 'empleado1', 2)
        const detalle = await abrirDetalle(page, turno)

        await detalle
          .getByRole('button', { name: 'Ausente', exact: true })
          .click()
        const popup = page.getByRole('dialog', {
          name: new RegExp(`^Marcar a ${reNombreDe('empleado1').source}`),
        })
        await expect(popup).toBeVisible()
        await expect(
          popup.getByText(
            'Elegí si presenta certificado. El motivo es opcional.',
          ),
        ).toBeVisible()
        await popup.getByRole('radio', { name: 'Con certificado' }).click()
        await popup.getByRole('button', { name: 'Marcar ausente' }).click()

        await expect(page.getByText('Avisamos la ausencia.')).toBeVisible()
        await expect(popup).toHaveCount(0)
        await expect(
          detalle.getByText('Ausente · con certificado'),
        ).toBeVisible()
        await expect(
          detalle.getByRole('button', { name: 'Cambiar' }),
        ).toBeVisible()
        // Ya avisada: no se ofrece «Ausente» de nuevo.
        await expect(
          detalle.getByRole('button', { name: 'Ausente', exact: true }),
        ).toHaveCount(0)

        const avisos = await avisosDe(sc, asignacion)
        expect(avisos).toHaveLength(1)
        expect(avisos[0]).toMatchObject({
          kind: 'absence',
          has_certificate: true,
          source: 'admin',
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'sin elegir el certificado da error de validación y no se crea el aviso; el servidor también lo exige',
    cubre('RB-A06', 'RB-A08', 'P-073'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const { turno, asignacion } = await armar(sc, 'empleado2', 2)
        const detalle = await abrirDetalle(page, turno)

        await detalle
          .getByRole('button', { name: 'Ausente', exact: true })
          .click()
        const popup = page.getByRole('dialog', {
          name: new RegExp(`^Marcar a ${reNombreDe('empleado2').source}`),
        })
        await popup.getByRole('button', { name: 'Marcar ausente' }).click()
        await expect(
          popup.getByText('Indicá si la ausencia tiene certificado.'),
        ).toBeVisible()
        await expect(popup).toBeVisible()
        expect(await avisosDe(sc, asignacion)).toHaveLength(0)

        await test.step('el motivo «Otro» exige el detalle aun con certificado elegido', async () => {
          await popup.getByRole('radio', { name: 'Sin certificado' }).click()
          await popup.getByRole('combobox', { name: 'Elegir motivo' }).click()
          await page.getByRole('option', { name: 'Otro' }).click()
          await popup.getByRole('button', { name: 'Marcar ausente' }).click()
          await expect(popup).toBeVisible()
          expect(await avisosDe(sc, asignacion)).toHaveLength(0)
        })

        await test.step('por API directa, administración sin certificado recibe CERTIFICATE_REQUIRED', async () => {
          const admin = await sessionClient('admin')
          expectHint(
            await admin.rpc('notify_absence', {
              p_assignment_id: asignacion,
              p_reason_code: 'illness',
            }),
            'CERTIFICATE_REQUIRED',
          )
          expect(await avisosDe(sc, asignacion)).toHaveLength(0)
        })

        await test.step('con «Sin certificado» y un motivo de la lista se guarda', async () => {
          await popup.getByRole('combobox', { name: 'Elegir motivo' }).click()
          await page.getByRole('option', { name: 'Enfermedad' }).click()
          await popup.getByRole('button', { name: 'Marcar ausente' }).click()
          await expect(
            detalle.getByText('Ausente · sin certificado'),
          ).toBeVisible()
          const avisos = await avisosDe(sc, asignacion)
          expect(avisos).toHaveLength(1)
          expect(avisos[0]).toMatchObject({
            kind: 'absence',
            has_certificate: false,
            reason_code: 'illness',
          })
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    '«Cambiar» pasa de con a sin certificado, registra quién lo cambió y se ve en Asistencia de hoy',
    cubre('RB-A06', 'RB-A08', 'P-073'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const { cliente, turno, asignacion } = await armar(sc, 'empleado3', 1)
        const admin = await sessionClient('admin')
        const alta = await admin.rpc('notify_absence', {
          p_assignment_id: asignacion,
          p_reason_code: 'personal',
          p_has_certificate: true,
        })
        expect(alta.error, alta.error?.message).toBeNull()

        const detalle = await abrirDetalle(page, turno)
        await expect(
          detalle.getByText('Ausente · con certificado'),
        ).toBeVisible()
        await detalle.getByRole('button', { name: 'Cambiar' }).click()
        const popup = page.getByRole('dialog', {
          name: new RegExp(
            `^Certificado de la ausencia de ${reNombreDe('empleado3').source}`,
          ),
        })
        await expect(popup).toBeVisible()
        await popup.getByRole('radio', { name: 'Sin certificado' }).click()
        await popup.getByRole('button', { name: 'Guardar' }).click()
        await expect(
          page.getByText('Guardamos el certificado de la ausencia.'),
        ).toBeVisible()
        await expect(
          detalle.getByText('Ausente · sin certificado'),
        ).toBeVisible()

        const avisos = await avisosDe(sc, asignacion)
        expect(avisos).toHaveLength(1)
        expect(avisos[0]).toMatchObject({
          has_certificate: false,
          updated_by: readId('admin'),
        })

        await test.step('Asistencia de hoy, en el día del turno, muestra «sin certificado»', async () => {
          await page.goto('/admin/asistencia')
          await page.getByRole('button', { name: 'Día siguiente' }).click()
          await page
            .getByPlaceholder('Buscar por nombre…')
            .fill(nombreDe('empleado3'))
          const fila = page.getByRole('row').filter({ hasText: cliente.name })
          await expect(fila).toContainText(/sin certificado/i)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
