// tests/e2e-responsive/touch-targets.spec.ts — RESP-003 (P17.2, F17)
//
// Objetivos táctiles de las pantallas de administración a 390 px (`07_Design_System.md`: "Objetivos
// táctiles >= 44 px en móvil"). Se mide el área EFECTIVA de toque con `elementFromPoint` (cuenta el
// `::after` de `IconButton` y descuenta lo que otro elemento tapa), no el tamaño visible. Los enlaces
// en línea dentro de un texto quedan fuera del conteo (WCAG 2.5.8, excepción "en línea").
// El detalle de cada objetivo chico se guarda en `hallazgos-touch-targets.jsonl`.

import { expect, test } from '@playwright/test'
import {
  describeTarget,
  loginStorageState,
  measureTouchTargets,
  newContextAt,
  recordFinding,
  smallTargets,
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
import { MANAGEMENT_SCREENS, OPERATION_SCREENS } from './helpers/screens.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eResponsiveEnv()
test.skip(!env, MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

const SPEC = 'touch-targets'
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
    console.log(`[${SPEC}] limpieza con notas:\n- ${notes.join('\n- ')}`)
  }
})

// Un test por grupo y no uno por pantalla: Playwright reinicia el proceso de trabajo (y rearma los
// datos) después de cada test fallido, y acá se espera encontrar objetivos chicos en muchas pantallas.
const GROUPS = [
  { name: 'operación (ADM-02 a ADM-15)', screens: OPERATION_SCREENS },
  {
    name: 'gestión y configuración (ADM-16 a ADM-31)',
    screens: MANAGEMENT_SCREENS,
  },
]

for (const group of GROUPS) {
  test(`RB-X01 · objetivos táctiles de 44 px a 390 px: ${group.name}`, async ({
    browser,
  }) => {
    test.setTimeout(540_000)
    const problems: string[] = []
    for (const screen of group.screens) {
      const context = await newContextAt(browser, ownerState, 390)
      const page = await context.newPage()
      try {
        await page.goto(screen.path(data))
        await waitForScreenLoaded(page)
        const targets = await measureTouchTargets(page)
        expect(
          targets.length,
          `${screen.id}: se midió algún control`,
        ).toBeGreaterThan(0)
        for (const target of smallTargets(targets)) {
          const detail = describeTarget(target)
          problems.push(`${screen.id}: ${detail}`)
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
    expect(
      problems,
      `${problems.length} controles con menos de 44 px de área de toque`,
    ).toEqual([])
  })
}
