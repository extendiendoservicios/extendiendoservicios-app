// tests/fixtures/axe.ts — TEST-023 (P18.4)
//
// Auditoría de accesibilidad con axe-core (`@axe-core/playwright`) para las pantallas principales
// de los tres roles, en escritorio y en celular.
//
// Criterio (encargo P18.4, `03_Plan_Maestro_Tecnico.md` sección 14 y 15): CERO violaciones de
// impacto `critical` y `serious`. Las de impacto `moderate` y `minor` se informan (anotación y
// adjunto) pero no hacen fallar la prueba.
//
// EXCEPCIÓN `color-contrast` (decisión de Mike en F17: los contrastes de los tokens del Design
// System, por ejemplo `--text-3` sobre `--surface` a 3,9:1 según `07_Design_System.md`, quedan
// por debajo de 4,5:1). Se eligió REPORTARLA APARTE y no excluirla de la ejecución: la regla
// corre igual, sus hallazgos se anotan en el informe (`contraste-aceptado`, con la cantidad de
// elementos) y se adjuntan, pero no hacen fallar la suite. Así la excepción es visible y medible
// (si alguien arregla un token, el número baja) en vez de desaparecer con un `disableRules`.

import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page, type TestInfo } from '@playwright/test'

/** Escritorio y celular, los dos tamaños que pide el encargo. */
export const VIEWPORTS_A11Y = [
  { nombre: 'escritorio', width: 1280, height: 900 },
  { nombre: 'celular', width: 390, height: 844 },
] as const

/** Regla de contraste: aceptada por Mike en F17 (ver arriba); se informa aparte. */
export const REGLA_CONTRASTE_ACEPTADA = 'color-contrast'

export interface ResumenAxe {
  pantalla: string
  viewport: string
  critical: number
  serious: number
  moderate: number
  minor: number
  contraste: number
  reglas: string[]
}

interface NodoAxe {
  target: unknown[]
  html: string
}
interface ViolacionAxe {
  id: string
  impact?: string | null
  help: string
  nodes: NodoAxe[]
}

function describir(v: ViolacionAxe): string {
  const donde = v.nodes
    .slice(0, 3)
    .map((n) => `${n.target.join(' ')}  ${n.html.slice(0, 110)}`)
    .join('\n      ')
  return `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} elemento/s)\n      ${donde}`
}

/**
 * Corre axe sobre la pantalla actual (ya cargada: el que llama espera a que se vea lo que
 * corresponde antes). Falla si hay violaciones `critical` o `serious` fuera del contraste.
 */
/** Espera a que la pantalla termine de cargar: contenido principal, sin esqueletos y sin pedidos en vuelo. */
export async function esperarPantallaLista(page: Page): Promise<void> {
  await expect(page.locator('main').first()).toBeVisible()
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
}

export async function auditarAccesibilidad(
  page: Page,
  testInfo: TestInfo,
  pantalla: string,
  viewport: string,
): Promise<ResumenAxe> {
  const resultado = await new AxeBuilder({ page }).analyze()
  const violaciones = resultado.violations as unknown as ViolacionAxe[]

  const contraste = violaciones.filter((v) => v.id === REGLA_CONTRASTE_ACEPTADA)
  const resto = violaciones.filter((v) => v.id !== REGLA_CONTRASTE_ACEPTADA)
  const graves = resto.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  )
  const contarPor = (nivel: string) =>
    resto.filter((v) => v.impact === nivel).length

  const resumen: ResumenAxe = {
    pantalla,
    viewport,
    critical: contarPor('critical'),
    serious: contarPor('serious'),
    moderate: contarPor('moderate'),
    minor: contarPor('minor'),
    contraste: contraste.reduce((total, v) => total + v.nodes.length, 0),
    reglas: resto.map((v) => `${v.impact}:${v.id}`),
  }

  testInfo.annotations.push({
    type: 'axe',
    description: `${pantalla} (${viewport}): critical=${resumen.critical} serious=${resumen.serious} moderate=${resumen.moderate} minor=${resumen.minor}; contraste aceptado=${resumen.contraste} elementos`,
  })
  if (resumen.contraste > 0) {
    testInfo.annotations.push({
      type: 'contraste-aceptado',
      description: `${pantalla} (${viewport}): ${resumen.contraste} elemento/s con contraste menor a 4,5:1 (decisión de Mike en F17, no falla la suite)`,
    })
  }
  // Una línea por pantalla en la salida, para armar el reporte de resultados.
  console.log(
    `[axe] ${pantalla} | ${viewport} | critical=${resumen.critical} serious=${resumen.serious} moderate=${resumen.moderate} minor=${resumen.minor} | contraste=${resumen.contraste}${resumen.reglas.length ? ` | ${resumen.reglas.join(',')}` : ''}`,
  )
  await testInfo.attach(`axe-${pantalla}-${viewport}.json`, {
    body: JSON.stringify(
      {
        resumen,
        violaciones: violaciones.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          elementos: v.nodes.map((n) => ({ target: n.target, html: n.html })),
        })),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  })

  expect
    .soft(
      graves.length,
      `${pantalla} (${viewport}) tiene violaciones critical o serious de axe:\n    ${graves
        .map(describir)
        .join('\n    ')}`,
    )
    .toBe(0)
  return resumen
}

/**
 * Audita la misma pantalla en escritorio y en celular: cambia el tamaño de la ventana, espera a
 * que `listo` confirme que la pantalla volvió a quedar lista y corre axe.
 */
export async function auditarEnAmbosTamanos(
  page: Page,
  testInfo: TestInfo,
  pantalla: string,
  listo: () => Promise<void>,
): Promise<void> {
  for (const v of VIEWPORTS_A11Y) {
    await page.setViewportSize({ width: v.width, height: v.height })
    await listo()
    await auditarAccesibilidad(page, testInfo, pantalla, v.nombre)
  }
}
