// tests/e2e-responsive/helpers/screenSuite.ts — RESP-003/RESP-005 (P17.2)
//
// Arma un archivo de spec que recorre una lista de pantallas de administración, con la cuenta del
// dueño, a cada ancho de `BASE_WIDTHS` (390, 768, 1024) y, en las 20 pantallas principales, también
// a 1366 y 1440. En cada ancho verifica por código:
//  - la pantalla abre en la ruta pedida (sin redirigir a otra);
//  - sin scroll horizontal (`scrollWidth <= innerWidth`);
//  - por debajo de 1024 px: tabbar (Hoy, Planificar, Asistencia, Supervisiones y Más), sin
//    sidebar, y ninguna tabla visible (RESP-005: las listas son tarjetas);
//  - desde 1024 px: sidebar (60 px hasta 1279, 236 px desde 1280) y sin tabbar;
//  - en los listados con datos del escenario, tarjetas (RowCard) en móvil.
// Guarda una captura de página completa por pantalla y ancho.

import { expect, test } from '@playwright/test'
import {
  MOBILE_BREAKPOINT,
  loginStorageState,
  measureAdminShell,
  measureHorizontalOverflow,
  newContextAt,
  recordFinding,
  takeShot,
  visibleTables,
  waitForScreenLoaded,
  type StorageState,
} from './checks.ts'
import { MISSING_ENV_MESSAGE, readE2eResponsiveEnv } from './env.ts'
import {
  NEAR_MIDNIGHT_MESSAGE,
  ResponsiveScenario,
  buildResponsiveData,
  isTooCloseToMidnight,
  type ResponsiveData,
} from './fixtures.ts'
import { BASE_WIDTHS, MAIN_WIDTHS, type AdminScreen } from './screens.ts'
import { SEED_ACCOUNTS } from '../../permissions/fixtures/seed-accounts.ts'

const TABBAR_LABELS = [
  'Hoy',
  'Planificar',
  'Asistencia',
  'Supervisiones',
  'Más',
]

export function defineScreenSuite(
  specName: string,
  title: string,
  screens: AdminScreen[],
): void {
  const env = readE2eResponsiveEnv()
  test.skip(!env, MISSING_ENV_MESSAGE)
  test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

  test.describe(title, () => {
    const scenario = env ? new ResponsiveScenario() : null
    let data: ResponsiveData
    let ownerState: StorageState

    test.beforeAll(async ({ browser }) => {
      data = await buildResponsiveData(scenario!)
      ownerState = await loginStorageState(
        browser,
        SEED_ACCOUNTS.owner,
        env!.seedPassword,
        /\/admin$/,
      )
    })

    test.afterAll(async () => {
      const notes = await scenario!.cleanup()
      if (notes.length > 0) {
        console.log(
          `[${specName}] limpieza con notas:\n- ${notes.join('\n- ')}`,
        )
      }
    })

    for (const screen of screens) {
      test(`RB-X01 · ${screen.id}: sin scroll horizontal, shell y tarjetas a cada ancho`, async ({
        browser,
      }) => {
        const widths = screen.main ? MAIN_WIDTHS : BASE_WIDTHS
        const problems: string[] = []
        const note = (
          width: number,
          kind: string,
          detail: string,
          shot?: string,
        ) => {
          problems.push(`[${width}px] ${kind}: ${detail}`)
          recordFinding({
            spec: specName,
            screen: screen.id,
            width,
            kind,
            detail,
            shot,
          })
        }

        for (const width of widths) {
          const context = await newContextAt(browser, ownerState, width)
          const page = await context.newPage()
          try {
            const target = screen.path(data)
            await page.goto(target)
            await waitForScreenLoaded(page)
            const shot = await takeShot(page, screen.id, width)

            const expectedPath = target.split('?')[0]
            const finalPath = new URL(page.url()).pathname
            if (finalPath !== expectedPath) {
              note(
                width,
                'redirección',
                `pidió ${expectedPath} y quedó en ${finalPath}`,
                shot,
              )
            }

            const overflow = await measureHorizontalOverflow(page)
            if (overflow.overflows) {
              note(
                width,
                'scroll-horizontal',
                `scrollWidth ${overflow.scrollWidth} (body ${overflow.bodyScrollWidth}) > innerWidth ${overflow.innerWidth}; ` +
                  `desbordan: ${overflow.offenders.join(' | ') || 'sin elemento identificado'}`,
                shot,
              )
            }

            const shell = await measureAdminShell(page)
            if (width < MOBILE_BREAKPOINT) {
              if (!shell.tabbarVisible) {
                note(
                  width,
                  'tabbar',
                  'no se ve la tabbar de administración',
                  shot,
                )
              } else if (
                JSON.stringify(shell.tabbarLabels) !==
                JSON.stringify(TABBAR_LABELS)
              ) {
                note(
                  width,
                  'tabbar',
                  `ítems ${JSON.stringify(shell.tabbarLabels)}, esperados ${JSON.stringify(TABBAR_LABELS)}`,
                  shot,
                )
              } else if ((shell.tabbarBottomGap ?? 0) > 1) {
                note(
                  width,
                  'tabbar',
                  `la tabbar no queda pegada al borde inferior (hueco de ${shell.tabbarBottomGap}px)`,
                  shot,
                )
              }
              if (shell.sidebarVisible) {
                note(
                  width,
                  'sidebar',
                  'se ve la sidebar por debajo de 1024 px',
                  shot,
                )
              }
              const tables = await visibleTables(page)
              if (tables > 0) {
                note(
                  width,
                  'tabla-en-móvil',
                  `${tables} tabla(s) visible(s) por debajo de 1024 px (RESP-005: tienen que ser tarjetas)`,
                  shot,
                )
              }
              if (screen.list) {
                const cards = await page
                  .locator('main div.shadow-card[class*="p-[14px]"]')
                  .count()
                if (cards === 0) {
                  note(
                    width,
                    'sin-tarjetas',
                    'el listado con datos del escenario no muestra ninguna tarjeta (RowCard)',
                    shot,
                  )
                }
              }
            } else {
              if (!shell.sidebarVisible) {
                note(
                  width,
                  'sidebar',
                  'no se ve la sidebar desde 1024 px',
                  shot,
                )
              } else {
                const expectedWidth = width >= 1280 ? 236 : 60
                if (shell.sidebarWidth !== expectedWidth) {
                  note(
                    width,
                    'sidebar',
                    `ancho ${shell.sidebarWidth}px, esperado ${expectedWidth}px`,
                    shot,
                  )
                }
              }
              if (shell.tabbarVisible) {
                note(width, 'tabbar', 'se ve la tabbar desde 1024 px', shot)
              }
            }
          } finally {
            await context.close()
          }
        }

        expect(problems, `${screen.id}:\n${problems.join('\n')}`).toEqual([])
      })
    }
  })
}
