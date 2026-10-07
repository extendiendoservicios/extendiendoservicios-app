import { expect, test } from '@playwright/test'
import { auditarAccesibilidad, esperarPantallaLista } from '../fixtures/axe.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { fijarConsentimiento, marcarCambiosVistos } from '../fixtures/movil.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { faltaMargenHaciaAdelante, franjaDesdeAhora } from './helpers/tiempo.ts'

// P19.5d · axe-core de «Estoy en camino» en el celular del empleado (390 px): la tarjeta con el
// botón, la hoja «¿En cuánto llegás?» abierta y la tarjeta con el aviso y «Cambiar hora estimada».

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('empleado4') })

test(
  'el botón, la hoja y el aviso de «Estoy en camino» no tienen violaciones críticas ni serias',
  cubre('RB-X01', 'RB-E07'),
  async ({ page }, testInfo) => {
    const motivo = faltaMargenHaciaAdelante(45, 60)
    test.skip(motivo !== null, motivo ?? '')
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('axe-camino')
      const sede = await sc.site(cliente.id, 'axe-camino')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        franjaDesdeAhora(45, 60),
      )
      await sc.assign(turno, 'empleado4')
      await fijarConsentimiento('empleado4', true)
      await marcarCambiosVistos('empleado4')

      await page.goto('/app')
      await expect(page.getByText(sede.name).first()).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Estoy en camino' }),
      ).toBeVisible()
      await esperarPantallaLista(page)
      await auditarAccesibilidad(
        page,
        testInfo,
        'AJ-02 Hoy con botón',
        'celular',
      )

      await page.getByRole('button', { name: 'Estoy en camino' }).click()
      const hoja = page.getByRole('dialog', { name: '¿En cuánto llegás?' })
      await expect(hoja).toBeVisible()
      await auditarAccesibilidad(
        page,
        testInfo,
        'AJ-02 Hoja de minutos',
        'celular',
      )

      await hoja.getByRole('button', { name: '20 min' }).click()
      await hoja.getByRole('button', { name: 'Confirmar' }).click()
      await expect(
        page.getByText(/Avisaste que estás en camino · llegás ~\d{2}:\d{2}/),
      ).toBeVisible()
      await auditarAccesibilidad(
        page,
        testInfo,
        'AJ-02 Hoy con aviso',
        'celular',
      )
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
