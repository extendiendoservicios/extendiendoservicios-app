// tests/e2e-responsive/structure.spec.ts — RESP-004/RESP-005/RESP-006/RESP-007 (P17.2, F17)
//
// Verificación de los cambios de estructura que el plan pide por debajo de 1024 px
// (`05_Pantallas_y_Navegacion.md` sección 7, `07_Design_System.md` "Drawer / Sheet"), con la cuenta
// del dueño y datos descartables `E2E-P172`:
//  - RESP-005: las listas son tarjetas (RowCard) y no tablas; desde 1024 px, tabla.
//  - RESP-006: ADM-06, ADM-14 y ADM-15 son páginas (no paneles) por debajo de 1024 y panel desde
//    1024; ADM-08, ADM-11 y los paneles de configuración ocupan toda la pantalla en 390 px.
//  - RESP-007: calendario mensual -> lista de días; grilla semanal -> un empleado por vez.
//  - RESP-004: el botón "Más" de la tabbar abre el resto de las secciones y navega.

import { expect, test, type Page } from '@playwright/test'
import {
  loginStorageState,
  newContextAt,
  recordFinding,
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
import { ALL_ADMIN_SCREENS } from './helpers/screens.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eResponsiveEnv()
test.skip(!env, MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

const SPEC = 'structure'
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

async function openAt(
  browser: Parameters<typeof newContextAt>[0],
  width: number,
  route: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await newContextAt(browser, ownerState, width)
  const page = await context.newPage()
  await page.goto(route)
  await waitForScreenLoaded(page)
  return { page, close: () => context.close() }
}

function report(screen: string, width: number, kind: string, detail: string) {
  recordFinding({ spec: SPEC, screen, width, kind, detail })
}

test.describe('RESP-005: listas como tarjetas (RowCard) en móvil, tabla desde 1024 px', () => {
  const lists = ALL_ADMIN_SCREENS.filter((screen) => screen.list)
  for (const screen of lists) {
    test(`RB-X01 · ${screen.id}: tarjetas a 390 y 768 px, tabla a 1024 px`, async ({
      browser,
    }) => {
      const problems: string[] = []
      for (const width of [390, 768, 1024]) {
        const { page, close } = await openAt(browser, width, screen.path(data))
        try {
          const tables = await page.locator('main table:visible').count()
          const cards = await page
            .locator('main div.shadow-card[class*="p-[14px]"]')
            .count()
          if (width < 1024) {
            if (tables > 0) {
              problems.push(`[${width}px] ${tables} tabla(s) visible(s)`)
            }
            if (cards === 0) problems.push(`[${width}px] no hay tarjetas`)
          } else if (tables === 0) {
            problems.push(`[${width}px] no hay tabla`)
          }
          // Una tarjeta nunca puede ser más ancha que la ventana.
          const wide = await page.evaluate(
            () =>
              Array.from(
                document.querySelectorAll(
                  'main div.shadow-card[class*="p-[14px]"]',
                ),
              ).filter(
                (el) =>
                  el.getBoundingClientRect().right > window.innerWidth + 0.5,
              ).length,
          )
          if (wide > 0)
            problems.push(
              `[${width}px] ${wide} tarjeta(s) se salen de la ventana`,
            )
        } finally {
          await close()
        }
      }
      problems.forEach((p) => report(screen.id, 0, 'lista', p))
      expect(problems, problems.join('\n')).toEqual([])
    })
  }
})

test.describe('RESP-006: drawers pasan a página completa en móvil', () => {
  const routeDrawers = [
    {
      id: 'ADM-06',
      route: () => `/admin/turnos/${data.shiftId}`,
      marker: () => data.clientName,
    },
    {
      id: 'ADM-15',
      route: () => `/admin/supervisiones/${data.supervisionId}`,
      marker: () => data.clientName,
    },
    {
      id: 'ADM-14',
      route: () => '/admin/supervisiones/nueva',
      marker: () => 'Asignar supervisión',
    },
  ]
  for (const drawer of routeDrawers) {
    test(`RB-X01 · ${drawer.id}: página por debajo de 1024 px, panel lateral desde 1024 px`, async ({
      browser,
    }) => {
      const problems: string[] = []
      for (const width of [390, 768, 1024, 1440]) {
        const { page, close } = await openAt(browser, width, drawer.route())
        try {
          const dialogs = await page.locator('[role="dialog"]').count()
          if (width < 1024 && dialogs > 0) {
            problems.push(`[${width}px] sigue siendo un panel (role=dialog)`)
            await takeShot(page, drawer.id, width, 'drawer')
          }
          if (width >= 1024 && dialogs === 0) {
            problems.push(
              `[${width}px] debería ser un panel lateral y no lo es`,
            )
          }
          const visibleMarker = await page
            .getByText(drawer.marker())
            .first()
            .isVisible()
          if (!visibleMarker) {
            problems.push(
              `[${width}px] no se ve el contenido (${drawer.marker()})`,
            )
          }
        } finally {
          await close()
        }
      }
      problems.forEach((p) => report(drawer.id, 0, 'drawer', p))
      expect(problems, problems.join('\n')).toEqual([])
    })
  }

  async function dialogBox(page: Page) {
    const dialog = page.locator('[role="dialog"]').last()
    await expect(dialog).toBeVisible()
    // Espera a que termine la animación de entrada (el panel se desliza desde la derecha).
    await dialog.evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    )
    return {
      box: await dialog.boundingBox(),
      viewport: page.viewportSize()!,
    }
  }

  const sheets = [
    {
      id: 'ADM-08 Asignar empleado',
      open: async (page: Page) => {
        await page.goto(`/admin/turnos/${data.uncoveredShiftId}`)
        await waitForScreenLoaded(page)
        await page
          .getByRole('button', { name: 'Asignar empleado' })
          .first()
          .click()
      },
    },
    {
      id: 'ADM-11 Registrar en nombre de',
      open: async (page: Page) => {
        await page.goto(`/admin/turnos/${data.shiftId}`)
        await waitForScreenLoaded(page)
        await page
          .getByRole('button', { name: 'Registrar en nombre' })
          .first()
          .click()
      },
    },
    {
      id: 'ADM-27 Nuevo administrador',
      open: async (page: Page) => {
        await page.goto('/admin/configuracion/usuarios')
        await waitForScreenLoaded(page)
        await page.getByRole('button', { name: 'Nuevo administrador' }).click()
      },
    },
    {
      id: 'ADM-30 Nuevo criterio',
      open: async (page: Page) => {
        await page.goto('/admin/configuracion/criterios')
        await waitForScreenLoaded(page)
        await page.getByRole('button', { name: 'Nuevo criterio' }).click()
      },
    },
  ]
  for (const sheet of sheets) {
    test(`RB-X01 · ${sheet.id}: ocupa toda la pantalla a 390 px`, async ({
      browser,
    }) => {
      const context = await newContextAt(browser, ownerState, 390)
      const page = await context.newPage()
      try {
        await sheet.open(page)
        const { box, viewport } = await dialogBox(page)
        await takeShot(page, sheet.id, 390, 'panel')
        expect(box, 'el panel tiene caja').not.toBeNull()
        expect(Math.round(box!.x), 'x del panel').toBeLessThanOrEqual(0)
        expect(
          Math.round(box!.width),
          'ancho del panel',
        ).toBeGreaterThanOrEqual(viewport.width)
        expect(
          Math.round(box!.height),
          'alto del panel',
        ).toBeGreaterThanOrEqual(viewport.height - 1)
      } finally {
        await context.close()
      }
    })

    test(`RB-X01 · ${sheet.id}: a 768 px (tablet vertical) -- ver pregunta sobre 05 sección 7 y 07`, async ({
      browser,
    }, testInfo) => {
      const context = await newContextAt(browser, ownerState, 768)
      const page = await context.newPage()
      try {
        await sheet.open(page)
        const { box, viewport } = await dialogBox(page)
        await takeShot(page, sheet.id, 768, 'panel')
        const full = Math.round(box!.width) >= viewport.width
        testInfo.annotations.push({
          type: 'pregunta',
          description: `${sheet.id} a 768 px mide ${Math.round(box!.width)} px de ancho (ventana ${viewport.width} px). 05 sección 7 dice "drawers -> páginas completas" por debajo de 1024; 07 dice 452 px y "en móvil ocupa toda la pantalla".`,
        })
        report(
          sheet.id,
          768,
          'drawer-tablet',
          `ancho ${Math.round(box!.width)} px, pantalla completa: ${full}`,
        )
        // Solo se exige que quepa en la ventana y sea utilizable.
        expect(Math.round(box!.width)).toBeLessThanOrEqual(viewport.width)
        expect(Math.round(box!.x + box!.width)).toBeLessThanOrEqual(
          viewport.width,
        )
      } finally {
        await context.close()
      }
    })
  }
})

test.describe('RESP-007: calendario mensual -> lista de días; grilla semanal -> un empleado', () => {
  test('RB-X01 · ADM-03: lista de días con conteo por debajo de 1024 px y grilla de 7 columnas desde 1024 px', async ({
    browser,
  }) => {
    const problems: string[] = []
    for (const width of [390, 768, 1024, 1366]) {
      const { page, close } = await openAt(
        browser,
        width,
        '/admin/planificacion',
      )
      try {
        const grid = await page.locator('main .grid-cols-7').count()
        const dayRows = await page.locator('main ul > li > button').count()
        if (width < 1024) {
          if (grid > 0)
            problems.push(`[${width}px] sigue la grilla de 7 columnas`)
          if (dayRows < 28)
            problems.push(
              `[${width}px] la lista tiene ${dayRows} días (esperados 28 a 31)`,
            )
          const conteo = await page
            .locator('main ul > li > button', { hasText: /\d+ turnos?/ })
            .count()
          if (conteo < dayRows)
            problems.push(
              `[${width}px] ${dayRows - conteo} días sin conteo de turnos`,
            )
        } else {
          if (grid === 0)
            problems.push(`[${width}px] falta la grilla de 7 columnas`)
          if (dayRows >= 28)
            problems.push(`[${width}px] se ve la lista de días en escritorio`)
        }
      } finally {
        await close()
      }
    }
    // Tocar un día lleva a ADM-05 con esa fecha.
    const { page, close } = await openAt(browser, 390, '/admin/planificacion')
    try {
      await page.locator('main ul > li > button').nth(1).click()
      await expect(page).toHaveURL(/vista=dia/)
      await expect(page).toHaveURL(/fecha=\d{4}-\d{2}-\d{2}/)
    } finally {
      await close()
    }
    problems.forEach((p) => report('ADM-03', 0, 'calendario', p))
    expect(problems, problems.join('\n')).toEqual([])
  })

  test('RB-X01 · ADM-04: un empleado por vez con selector por debajo de 1024 px, grilla desde 1024 px', async ({
    browser,
  }) => {
    const problems: string[] = []
    for (const width of [390, 768, 1024, 1366]) {
      const { page, close } = await openAt(
        browser,
        width,
        '/admin/planificacion?vista=semana',
      )
      try {
        // Acota la lista a la persona propia de la prueba.
        await page
          .getByPlaceholder('Buscar empleado…')
          .fill(data.employee.lastName)
        const tables = await page.locator('main table:visible').count()
        if (width < 1024) {
          if (tables > 0)
            problems.push(`[${width}px] sigue la tabla de empleados x días`)
          const selector = page.getByRole('combobox', {
            name: 'Elegir empleado',
          })
          await expect(selector).toBeVisible()
          await expect(selector).toContainText(data.employee.lastName)
          const days = await page.locator('main ul > li').count()
          if (days !== 7)
            problems.push(
              `[${width}px] la semana tiene ${days} días (esperados 7)`,
            )
          await expect(
            page
              .locator('main ul > li')
              .filter({ hasText: data.siteName })
              .first(),
          ).toBeVisible()
        } else {
          if (tables === 0) problems.push(`[${width}px] falta la grilla`)
          const headers = await page.locator('main table thead th').count()
          if (headers !== 8)
            problems.push(
              `[${width}px] la grilla tiene ${headers} columnas (esperadas 8)`,
            )
          await expect(
            page
              .locator('main table tbody tr')
              .filter({ hasText: data.employee.lastName }),
          ).toHaveCount(1)
        }
      } finally {
        await close()
      }
    }
    problems.forEach((p) => report('ADM-04', 0, 'semana', p))
    expect(problems, problems.join('\n')).toEqual([])
  })
})

test.describe('RESP-004: "Más" de la tabbar de administración', () => {
  for (const width of [390, 768]) {
    test(`RB-X01 · "Más" abre las cuatro secciones restantes y navega (${width} px)`, async ({
      browser,
    }) => {
      const { page, close } = await openAt(browser, width, '/admin')
      try {
        await page.getByRole('button', { name: 'Más' }).click()
        const dialog = page.getByRole('dialog', { name: 'Más' })
        await expect(dialog).toBeVisible()
        for (const label of [
          'Empleados',
          'Clientes y sedes',
          'Tareas',
          'Configuración',
        ]) {
          await expect(dialog.getByRole('link', { name: label })).toBeVisible()
        }
        const box = await dialog.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        await takeShot(page, 'mas', width)
        await dialog.getByRole('link', { name: 'Empleados' }).click()
        await expect(page).toHaveURL(/\/admin\/empleados$/)
        await expect(dialog).toBeHidden()
        await expect(page.getByRole('button', { name: 'Más' })).toHaveClass(
          /text-primary/,
        )
      } finally {
        await close()
      }
    })
  }
})
