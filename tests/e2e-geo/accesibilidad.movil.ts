import { expect, test } from '@playwright/test'
import { auditarAccesibilidad, esperarPantallaLista } from '../fixtures/axe.ts'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { fijarConsentimiento, marcarCambiosVistos } from '../fixtures/movil.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import {
  desplazar,
  SEDE_COORDS,
  simularPosicion,
  turnoDeHoy,
} from './helpers/geo.ts'

// P22.5 · Accesibilidad (axe-core, sin violaciones críticas ni serias) de las pantallas de celular
// que trae B1: fichar con el panel de ubicación (fuera, precisión mala y esperando señal), el
// resultado del fichaje, Finalizar y el consentimiento. Cuenta: empleado3.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
test.use({ storageState: storageStatePath('empleado3') })

test(
  'axe: EMP-05 y EMP-10 con el panel de ubicación en vivo, pantalla de resultado y consentimiento',
  cubre('RB-X01', 'B-18', 'B-22'),
  async ({ page, context }, testInfo) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    try {
      const t = await turnoDeHoy(sc, 'geo-axe', 'empleado3', { radio: 100 })
      await fijarConsentimiento('empleado3', true)
      await marcarCambiosVistos('empleado3')

      // Primero la señal mala (la mejor lectura se conserva: solo puede ir mejorando).
      await simularPosicion(context, SEDE_COORDS, 130)
      await page.goto('/app/fichar')
      await expect(page.getByTestId('geo-accuracy')).toHaveText(
        'Precisión: 130 m',
      )
      await auditarAccesibilidad(page, testInfo, 'EMP-05 precisión mala', '390')
      await page.getByRole('button', { name: 'Esperar mejor señal' }).click()
      await expect(page.getByText(/Esperando mejor señal/)).toBeVisible()
      await auditarAccesibilidad(
        page,
        testInfo,
        'EMP-05 esperando señal',
        '390',
      )

      await simularPosicion(context, desplazar(SEDE_COORDS, 600), 10)
      await expect(page.getByTestId('geo-accuracy')).toHaveText(
        'Precisión: 10 m',
      )
      await expect(
        page.getByLabel('¿Por qué estás fuera de la zona? (opcional)'),
      ).toBeVisible()
      await auditarAccesibilidad(
        page,
        testInfo,
        'EMP-05 fuera de zona con motivo',
        '390',
      )

      await simularPosicion(context, SEDE_COORDS, 5)
      await expect(page.getByTestId('geo-accuracy')).toHaveText(
        'Precisión: 5 m',
      )
      await page.getByRole('button', { name: 'Registrar inicio' }).click()
      await expect(page.getByTestId('attendance-result')).toBeVisible()
      await auditarAccesibilidad(page, testInfo, 'Resultado del fichaje', '390')

      await page.goto(`/app/en-curso/${t.asignacionId}/finalizar`)
      await expect(page.getByTestId('geo-accuracy')).toHaveText(
        'Precisión: 5 m',
      )
      await auditarAccesibilidad(
        page,
        testInfo,
        'EMP-10 con el panel de ubicación',
        '390',
      )

      await page.goto('/app/fichar/consentimiento')
      await esperarPantallaLista(page)
      await auditarAccesibilidad(page, testInfo, 'EMP-06 consentimiento', '390')
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
