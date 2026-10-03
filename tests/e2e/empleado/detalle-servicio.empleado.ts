import { expect, test } from '@playwright/test'
import {
  daysFromToday,
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  fijarConsentimiento,
  marcarCambiosVistos,
  tareasDelTurno,
} from '../../fixtures/movil.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// TEST-017 (P18.2): EMP-04 "Detalle del servicio" (RB-E03, P-029, P-103). Cuentas de este
// archivo: empleado2 (quien mira) y empleado3 (compañero del mismo turno).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado2') })

test(
  'el detalle muestra dónde, cuándo y qué hacer: sede, mapa, horario, contacto, tareas previstas y compañeros',
  cubre('RB-E03', 'RB-E02', 'P-103'),
  async ({ page }) => {
    const sc = new Scenario()
    try {
      const cliente = await sc.client('detalle')
      const sede = await sc.site(cliente.id, 'detalle', {
        lat: -34.6037,
        lng: -58.3816,
      })
      const { error } = await sc.db
        .from('sites')
        .update({
          address: 'Calle de Prueba 123',
          city: 'CABA',
          building_hours: 'Lunes a viernes de 7 a 20',
          access_instructions: 'Tocar el timbre de Portería.',
          contact_name: 'Contacto E2E',
          contact_phone: '+541155550000',
        })
        .eq('id', sede.id)
      expect(error, error?.message).toBeNull()

      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS.manana,
        2,
      )
      await tareasDelTurno(turno, [
        { title: 'e2e-detalle: limpiar vidrios', required: true },
        { title: 'e2e-detalle: reponer insumos', required: false },
      ])
      const asignacion = await sc.assign(turno, 'empleado2')
      await sc.assign(turno, 'empleado3')
      await marcarCambiosVistos('empleado2')

      await page.goto(`/app/servicio/${asignacion}`)
      await expectNoHorizontalScroll(page)

      await test.step('cliente, sede, estado propio, horario y duración', async () => {
        await expect(page.getByText(cliente.name).first()).toBeVisible()
        await expect(page.getByText(sede.name).first()).toBeVisible()
        await expect(page.getByText('Esperado').first()).toBeVisible()
        await expect(page.getByText(/08:00–12:00/)).toBeVisible()
        await expect(page.getByText(/4 h/)).toBeVisible()
      })

      await test.step('dirección, enlace al mapa con las coordenadas, horario del edificio y acceso', async () => {
        await expect(page.getByText('Calle de Prueba 123, CABA')).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Abrir en el mapa' }),
        ).toHaveAttribute(
          'href',
          'https://www.google.com/maps/search/?api=1&query=-34.6037,-58.3816',
        )
        await expect(page.getByText('Lunes a viernes de 7 a 20')).toBeVisible()
        await expect(
          page.getByText('Tocar el timbre de Portería.'),
        ).toBeVisible()
      })

      await test.step('contacto de la sede: se llama con tel:', async () => {
        await expect(page.getByText('Contacto E2E')).toBeVisible()
        await expect(
          page.getByRole('link', { name: '+541155550000' }),
        ).toHaveAttribute('href', 'tel:+541155550000')
      })

      await test.step('compañeros del turno (nombre; P-103) sin datos de nadie más', async () => {
        const companeros = page
          .locator('[data-slot="card"]')
          .filter({ hasText: 'Compañeros de este servicio' })
        await expect(companeros).toContainText('E2E-Fijo Empleado3')
        await expect(companeros).not.toContainText('E2E-Fijo Empleado2')
      })

      await test.step('tareas previstas en solo lectura (antes del inicio)', async () => {
        await expect(page.getByText('Tareas previstas')).toBeVisible()
        await expect(
          page.getByText('e2e-detalle: limpiar vidrios'),
        ).toBeVisible()
        await expect(
          page.getByText('e2e-detalle: reponer insumos'),
        ).toBeVisible()
        await expect(
          page.getByRole('checkbox', { name: /limpiar vidrios/ }),
        ).toBeDisabled()
      })

      await test.step('acceso a avisar con el servicio ya elegido', async () => {
        await page
          .getByRole('link', { name: 'Avisar demora o ausencia' })
          .click()
        await expect(page).toHaveURL(
          new RegExp(`/app/avisar\\?asignacion=${asignacion}`),
        )
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'las restricciones de la sede se muestran como información y no impiden fichar (P-029)',
  cubre('RB-E03', 'P-029'),
  async ({ page }) => {
    const sc = new Scenario()
    try {
      const cliente = await sc.client('restricciones')
      const sede = await sc.site(cliente.id, 'restricciones')
      const { error } = await sc.db
        .from('sites')
        .update({
          phone_restricted: true,
          photos_not_allowed: true,
          restrictions_notes: 'e2e: ingresar con calzado de seguridad',
        })
        .eq('id', sede.id)
      expect(error, error?.message).toBeNull()
      // Madrugada: a cualquier hora del día ya empezó; el consentimiento ya está dado para ir
      // directo al botón de registro.
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS.madrugada,
      )
      const asignacion = await sc.assign(turno, 'empleado2')
      await fijarConsentimiento('empleado2', true)
      await marcarCambiosVistos('empleado2')

      await test.step('EMP-04 lista las tres restricciones', async () => {
        await page.goto(`/app/servicio/${asignacion}`)
        const bloque = page.getByText('Restricciones de la sede').locator('..')
        await expect(bloque).toContainText('No usar el teléfono en la sede.')
        await expect(bloque).toContainText('No se permiten fotos.')
        await expect(bloque).toContainText(
          'e2e: ingresar con calzado de seguridad',
        )
      })

      await test.step('es solo informativo: se puede registrar el inicio igual', async () => {
        await page.goto('/app/fichar')
        const registrar = page.getByRole('button', { name: 'Registrar inicio' })
        await expect(registrar).toBeEnabled()
        await registrar.click()
        await expect(page).toHaveURL(new RegExp(`/app/en-curso/${asignacion}$`))
      })

      await test.step('sin restricciones cargadas, el bloque no aparece', async () => {
        const otraSede = await sc.site(cliente.id, 'sin-restricciones')
        const otroTurno = await sc.shift(
          cliente.id,
          otraSede.id,
          daysFromToday(1),
          FRANJAS.manana,
        )
        const otraAsignacion = await sc.assign(otroTurno, 'empleado2')
        await page.goto(`/app/servicio/${otraAsignacion}`)
        await expect(page.getByText(otraSede.name).first()).toBeVisible()
        await expect(page.getByText('Restricciones de la sede')).toHaveCount(0)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
