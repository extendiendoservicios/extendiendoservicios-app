import { expect, test } from '@playwright/test'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P28.7 (celular, 390 px). Cuenta de este archivo: empleado3.
//   - OF-04b (0083): cancelar un turno libera al empleado (puede tomar otro turno a la misma hora)
//     y él lo sigue viendo como «Cancelado» en su celular.
//   - OF-09 (P28.2): el banner de instalación con el user agent de iPhone: pasos en Safari y
//     «Abrí este enlace en Safari» en otro navegador; las metas `apple-mobile-web-app-*`.
//   - OF-03: el empleado no ve precios ni stock (por pantalla).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const UA_SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const UA_CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1'
const UA_WHATSAPP_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.8.80'

test.describe('OF-04b: turno cancelado', () => {
  test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
  test.use({ storageState: storageStatePath('empleado3') })

  test(
    'cancelar el turno libera al empleado para otro turno a la misma hora y él lo sigue viendo como Cancelado',
    cubre('RB-E02', 'CB-03', 'P-049', 'OF-04b'),
    async ({ page }) => {
      test.setTimeout(120_000)
      const sc = new Scenario()
      try {
        const clienteA = await sc.client('of04b-a')
        const sedeA = await sc.site(clienteA.id, 'of04b-a')
        const clienteB = await sc.client('of04b-b')
        const sedeB = await sc.site(clienteB.id, 'of04b-b')
        const turnoA = await sc.shift(
          clienteA.id,
          sedeA.id,
          sc.today,
          FRANJAS.noche,
        )
        const turnoB = await sc.shift(
          clienteB.id,
          sedeB.id,
          sc.today,
          FRANJAS.noche,
        )
        const asignacionA = await sc.assign(turnoA, 'empleado3')

        const owner = await sessionClient('owner')
        await test.step('con el turno A vivo, no se lo puede asignar al B a la misma hora', async () => {
          const r = await owner.rpc('assign_employee', {
            p_shift_id: turnoB,
            p_employee_id: readId('empleado3'),
          })
          expect(r.error?.hint).toBe('ASSIGNMENT_OVERLAP')
        })

        await test.step('se cancela el turno A: la asignación queda liberada, no quitada', async () => {
          const r = await owner.rpc('cancel_shift', {
            p_shift_id: turnoA,
            p_reason: 'e2e p28: cancelado',
          })
          expect(r.error, r.error?.message).toBeNull()
          const { data } = await sc.db
            .from('assignments')
            .select('removed_at, released_at')
            .eq('id', asignacionA)
            .single()
          expect(data?.removed_at).toBeNull()
          expect(data?.released_at).not.toBeNull()
        })

        await test.step('ahora sí se lo asigna al turno B a la misma hora', async () => {
          await sc.assign(turnoB, 'empleado3')
        })

        await test.step('en su celular: el A como Cancelado y el B como servicio normal', async () => {
          await page.goto('/app')
          const main = page.getByRole('main')
          await expect(main).toContainText(clienteA.name)
          await expect(main).toContainText(clienteB.name)
          await expect(
            main.getByText('Cancelado', { exact: true }),
          ).toBeVisible()
          await expectNoHorizontalScroll(page)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('OF-09: instalar en iPhone', () => {
  test.use({ storageState: storageStatePath('empleado3') })

  test.describe('Safari de iPhone', () => {
    test.use({ userAgent: UA_SAFARI_IPHONE })

    test(
      'el banner muestra los tres pasos con el ícono de Compartir y se puede cerrar',
      cubre('RB-X01', 'OF-09'),
      async ({ page }) => {
        await page.goto('/app')
        const banner = page.getByRole('alert').filter({
          hasText: 'Instalá la aplicación',
        })
        await expect(banner).toBeVisible()
        await expect(banner).toContainText(
          'Para agregarla a tu pantalla de inicio',
        )
        await expect(banner.getByRole('listitem')).toHaveCount(3)
        await expect(
          banner.getByRole('img', { name: 'Compartir' }),
        ).toBeVisible()
        await expect(banner).toContainText('Agregar a pantalla de inicio')
        await expect(banner).not.toContainText('Abrí este enlace en Safari')
        await expectNoHorizontalScroll(page)
        await banner.getByRole('button', { name: 'Cerrar' }).click()
        await expect(banner).toHaveCount(0)
        // Cerrado: no vuelve al recargar (siete días).
        await page.reload()
        await expect(page.getByRole('main')).toBeVisible()
        await expect(
          page.getByRole('alert').filter({ hasText: 'Instalá la aplicación' }),
        ).toHaveCount(0)
      },
    )
  })

  for (const [nombre, ua] of [
    ['Chrome de iPhone', UA_CHROME_IPHONE],
    ['el navegador de WhatsApp en iPhone', UA_WHATSAPP_IPHONE],
  ] as const) {
    test.describe(nombre, () => {
      test.use({ userAgent: ua })

      test(
        'avisa «Abrí este enlace en Safari» y ofrece «Copiar enlace», sin los pasos',
        cubre('RB-X01', 'OF-09'),
        async ({ page, context }) => {
          await context.grantPermissions(['clipboard-read', 'clipboard-write'])
          await page.goto('/app')
          const banner = page.getByRole('alert').filter({
            hasText: 'Instalá la aplicación',
          })
          await expect(banner).toBeVisible()
          await expect(banner).toContainText(
            'Para instalar la app, abrí este enlace en Safari.',
          )
          await expect(banner.getByRole('listitem')).toHaveCount(0)
          await banner.getByRole('button', { name: 'Copiar enlace' }).click()
          await expect(banner).toContainText(
            'Enlace copiado. Pegalo en Safari.',
          )
          const copiado = await page.evaluate(() =>
            navigator.clipboard.readText(),
          )
          expect(copiado).toContain('/app')
        },
      )
    })
  }

  test.describe('no es iPhone', () => {
    test(
      'en Chrome de Android sin el evento de instalación no hay banner de iPhone',
      cubre('RB-X01', 'OF-09'),
      async ({ page }) => {
        await page.goto('/app')
        await expect(page.getByRole('main')).toBeVisible()
        await expect(
          page.getByText('Para agregarla a tu pantalla de inicio'),
        ).toHaveCount(0)
        await expect(page.getByText('abrí este enlace en Safari')).toHaveCount(
          0,
        )
      },
    )
  })

  test(
    'las metas de iPhone están en el HTML (apple-mobile-web-app-*)',
    cubre('RB-X01', 'OF-09'),
    async ({ page }) => {
      await page.goto('/ingresar')
      await expect(
        page.locator('meta[name="apple-mobile-web-app-capable"]'),
      ).toHaveAttribute('content', 'yes')
      await expect(
        page.locator('meta[name="apple-mobile-web-app-title"]'),
      ).toHaveCount(1)
      await expect(
        page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
      ).toHaveCount(1)
      await expect(
        page.locator('meta[name="mobile-web-app-capable"]'),
      ).toHaveAttribute('content', 'yes')
    },
  )
})
