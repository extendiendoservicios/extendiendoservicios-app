// tests/e2e-responsive/mobile-390.spec.ts — RESP-003 / RESP-008 (P17.2, F17)
//
// Pasada rápida de las pantallas de empleado (`/app`) y supervisor (`/sup`) a 390 px, con un área
// segura simulada de iPhone con muesca (47 px arriba, 34 px abajo; Chromium no emula
// `env(safe-area-inset-*)`, así que se pisan las variables `--safe-*` de `tokens.css`):
//  - sin scroll horizontal;
//  - cabecera: el contenido empieza por debajo del área segura superior y la barra pegajosa sigue
//    pegada al borde al scrollear;
//  - tabbar (en las pestañas raíz): pegada al borde inferior y con los ítems por encima del área
//    segura; el FAB "Fichar" dentro de la tabbar y por encima del área segura;
//  - ActionBar (si la pantalla la tiene): sus botones por encima del área segura y sin tapar el
//    contenido del final de la página;
//  - objetivos táctiles de 44 px (mismo criterio que `touch-targets.spec.ts`).
// Las capturas quedan en `test-results/responsive-capturas/`.

import { expect, test, type Page } from '@playwright/test'
import {
  SAFE_BOTTOM,
  SAFE_TOP,
  describeTarget,
  loginStorageState,
  measureHorizontalOverflow,
  measureTouchTargets,
  newContextAt,
  recordFinding,
  simulateSafeArea,
  smallTargets,
  takeShot,
  waitForScreenLoaded,
  type StorageState,
} from './helpers/checks.ts'
import { MISSING_ENV_MESSAGE, readE2eResponsiveEnv } from './helpers/env.ts'
import {
  NEAR_MIDNIGHT_MESSAGE,
  ResponsiveScenario,
  buildResponsiveData,
  isTooCloseToMidnight,
  type ResponsiveData,
} from './helpers/fixtures.ts'
import { MOBILE_SCREENS } from './helpers/screens.ts'

const env = readE2eResponsiveEnv()
test.skip(!env, MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

const SPEC = 'mobile-390'
const scenario = env ? new ResponsiveScenario() : null
let data: ResponsiveData
const states: Partial<
  Record<'employee' | 'working' | 'supervisor', StorageState>
> = {}

test.beforeAll(async ({ browser }) => {
  data = await buildResponsiveData(scenario!)
  states.employee = await loginStorageState(
    browser,
    data.employee.email,
    data.employee.password,
    /\/app$/,
  )
  states.working = await loginStorageState(
    browser,
    data.employeeWorking.email,
    data.employeeWorking.password,
    /\/app$/,
  )
  states.supervisor = await loginStorageState(
    browser,
    data.supervisor.email,
    data.supervisor.password,
    /\/sup$/,
  )
})

test.afterAll(async () => {
  const notes = await scenario!.cleanup()
  if (notes.length > 0) {
    console.log(`[${SPEC}] limpieza con notas:\n- ${notes.join('\n- ')}`)
  }
})

interface SafeAreaMetrics {
  headerTop: number | null
  headerContentTop: number | null
  headerSticky: boolean
  tabbar: { bottomGap: number; lastItemBottom: number } | null
  fab: { bottom: number } | null
  actionBars: { bottom: number; lastButtonBottom: number; top: number }[]
  mainLastBottom: number | null
  tabbarTop: number | null
  innerHeight: number
  scrolledHeaderTop: number | null
}

async function measureSafeArea(page: Page): Promise<SafeAreaMetrics> {
  // Se baja hasta el final para medir el pie con el contenido más abajo posible.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  return page.evaluate(() => {
    const header = document.querySelector('header')
    const headerRect = header?.getBoundingClientRect() ?? null
    const firstContent = header?.querySelector('p, div, button') ?? null
    const tabbar = document.querySelector(
      'nav[aria-label="Navegación principal"]',
    )
    const tabbarRect = tabbar?.getBoundingClientRect() ?? null
    const items = tabbar ? Array.from(tabbar.querySelectorAll('a, button')) : []
    const fab = document.querySelector('[data-slot="fab"]')
    const main = document.querySelector('main')
    const bars = Array.from(
      document.querySelectorAll<HTMLElement>('main *'),
    ).filter((el) => {
      const style = getComputedStyle(el)
      return (
        style.position === 'sticky' &&
        style.bottom === '0px' &&
        el.querySelector('button, a')
      )
    })
    // Hijos directos de main: el último elemento de contenido que no es una barra.
    const lastContent = main
      ? Array.from(main.children)
          .filter((el) => !bars.includes(el as HTMLElement))
          .at(-1)
      : null
    return {
      headerTop: headerRect ? Math.round(headerRect.top) : null,
      headerContentTop: firstContent
        ? Math.round(firstContent.getBoundingClientRect().top)
        : null,
      headerSticky: header
        ? getComputedStyle(header).position === 'sticky'
        : false,
      tabbar: tabbarRect
        ? {
            bottomGap: Math.round(window.innerHeight - tabbarRect.bottom),
            lastItemBottom: Math.round(
              Math.max(...items.map((el) => el.getBoundingClientRect().bottom)),
            ),
          }
        : null,
      fab: fab
        ? { bottom: Math.round(fab.getBoundingClientRect().bottom) }
        : null,
      actionBars: bars.map((el) => {
        const buttons = Array.from(el.querySelectorAll('button, a'))
        return {
          top: Math.round(el.getBoundingClientRect().top),
          bottom: Math.round(el.getBoundingClientRect().bottom),
          lastButtonBottom: Math.round(
            Math.max(...buttons.map((b) => b.getBoundingClientRect().bottom)),
          ),
        }
      }),
      mainLastBottom: lastContent
        ? Math.round(lastContent.getBoundingClientRect().bottom)
        : null,
      tabbarTop: tabbarRect ? Math.round(tabbarRect.top) : null,
      innerHeight: window.innerHeight,
      scrolledHeaderTop: headerRect ? Math.round(headerRect.top) : null,
    }
  })
}

test.describe('RESP-003/RESP-008: empleado y supervisor a 390 px con área segura', () => {
  test('RB-X01 · pantallas /app y /sup: sin scroll horizontal, cabecera, tabbar, FAB y ActionBar fuera del área segura', async ({
    browser,
  }) => {
    test.setTimeout(540_000)
    const problems: string[] = []
    const small: string[] = []

    for (const screen of MOBILE_SCREENS) {
      const context = await newContextAt(browser, states[screen.who]!, 390)
      const page = await context.newPage()
      await simulateSafeArea(page)
      const note = (kind: string, detail: string, shot?: string) => {
        problems.push(`${screen.id} [${kind}] ${detail}`)
        recordFinding({
          spec: SPEC,
          screen: screen.id,
          width: 390,
          kind,
          detail,
          shot,
        })
      }
      try {
        const target = screen.path(data)
        await page.goto(target)
        await waitForScreenLoaded(page)
        const shot = await takeShot(page, screen.id, 390, 'segura')

        const finalPath = new URL(page.url()).pathname
        if (finalPath !== target.split('?')[0]) {
          note('redirección', `pidió ${target} y quedó en ${finalPath}`, shot)
        }

        const overflow = await measureHorizontalOverflow(page)
        if (overflow.overflows) {
          note(
            'scroll-horizontal',
            `scrollWidth ${overflow.scrollWidth} > ${overflow.innerWidth}: ${overflow.offenders.join(' | ')}`,
            shot,
          )
        }

        const m = await measureSafeArea(page)
        if (m.headerContentTop !== null && m.headerContentTop < SAFE_TOP) {
          note(
            'área-segura-arriba',
            `el contenido de la cabecera empieza a ${m.headerContentTop}px y el área segura mide ${SAFE_TOP}px`,
            shot,
          )
        }
        if (m.tabbar) {
          if (m.tabbar.bottomGap > 1) {
            note(
              'tabbar',
              `no está pegada al borde inferior (hueco ${m.tabbar.bottomGap}px)`,
              shot,
            )
          }
          if (m.tabbar.lastItemBottom > m.innerHeight - SAFE_BOTTOM + 1) {
            note(
              'área-segura-abajo',
              `los ítems de la tabbar llegan a ${m.tabbar.lastItemBottom}px y el área segura empieza en ${m.innerHeight - SAFE_BOTTOM}px`,
              shot,
            )
          }
          if (m.fab && m.fab.bottom > m.innerHeight - SAFE_BOTTOM + 1) {
            note(
              'fab',
              `el FAB llega a ${m.fab.bottom}px, dentro del área segura (${m.innerHeight - SAFE_BOTTOM}px)`,
              shot,
            )
          }
          if (
            m.mainLastBottom !== null &&
            m.tabbarTop !== null &&
            m.mainLastBottom > m.tabbarTop + 1
          ) {
            note(
              'contenido-tapado',
              `el final del contenido (${m.mainLastBottom}px) queda bajo la tabbar (${m.tabbarTop}px)`,
              shot,
            )
          }
        }
        for (const bar of m.actionBars) {
          if (bar.lastButtonBottom > m.innerHeight - SAFE_BOTTOM + 1) {
            note(
              'actionbar',
              `los botones de la ActionBar llegan a ${bar.lastButtonBottom}px, dentro del área segura (${m.innerHeight - SAFE_BOTTOM}px)`,
              shot,
            )
          }
        }
        if (m.headerSticky) {
          // Con scroll, la barra pegajosa tiene que seguir en el borde superior.
          if (m.scrolledHeaderTop !== 0) {
            note(
              'cabecera-pegajosa',
              `con scroll la cabecera quedó a ${m.scrolledHeaderTop}px del borde`,
              shot,
            )
          }
        }

        const targets = await measureTouchTargets(page)
        for (const t of smallTargets(targets)) {
          const detail = describeTarget(t)
          small.push(`${screen.id}: ${detail}`)
          recordFinding({
            spec: SPEC,
            screen: screen.id,
            width: 390,
            kind: 'toque',
            detail,
          })
        }
      } finally {
        await context.close()
      }
    }

    expect(problems, problems.join('\n')).toEqual([])
    expect(
      small,
      `${small.length} controles con menos de 44 px de toque`,
    ).toEqual([])
  })
})
