// tests/e2e-responsive/helpers/checks.ts — RESP-003 a RESP-007 (P17.2)
//
// Verificaciones en la página (se ejecutan dentro del navegador con `page.evaluate`) y utilidades
// de sesión, captura y registro de hallazgos. Nada de `sleep` fijos: todas las esperas son
// aserciones o `waitFor`.

import { appendFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { loginAs } from './login.ts'

const APP_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Carpeta de capturas y resultados: dentro de `test-results/`, ignorada por git. */
export const CAPTURAS_DIR = path.join(
  APP_ROOT,
  'test-results',
  'responsive-capturas',
)

export const MOBILE_BREAKPOINT = 1024

/** Alto de ventana por ancho (referencia de dispositivos reales). */
export function viewportFor(width: number): { width: number; height: number } {
  if (width <= 400) return { width, height: 844 }
  if (width <= 800) return { width, height: 1024 }
  return { width, height: 900 }
}

export interface StorageState {
  cookies: Awaited<ReturnType<BrowserContext['storageState']>>['cookies']
  origins: Awaited<ReturnType<BrowserContext['storageState']>>['origins']
}

/** Inicia sesión una vez por la interfaz y devuelve el estado de almacenamiento reutilizable. */
export async function loginStorageState(
  browser: Browser,
  email: string,
  password: string,
  homePattern: RegExp,
): Promise<StorageState> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  })
  const page = await context.newPage()
  await loginAs(page, email, password, homePattern)
  const state = await context.storageState()
  await context.close()
  return state
}

/**
 * Contexto nuevo con el ancho pedido. Por debajo de 1024 px emula un celular o tablet (táctil,
 * `isMobile`, densidad 2): así `useEditingField` y `(pointer: coarse)` se comportan como en un
 * dispositivo real.
 */
export async function newContextAt(
  browser: Browser,
  state: StorageState,
  width: number,
): Promise<BrowserContext> {
  const touch = width < MOBILE_BREAKPOINT
  return browser.newContext({
    storageState: state,
    viewport: viewportFor(width),
    isMobile: touch,
    hasTouch: touch,
    deviceScaleFactor: touch ? 2 : 1,
    locale: 'es-AR',
    permissions: ['geolocation'],
    geolocation: { latitude: -34.5, longitude: -58.45, accuracy: 15 },
    timezoneId: 'America/Argentina/Buenos_Aires',
  })
}

/** Espera a que la pantalla termine de cargar (sin esqueletos) y la red se aquiete. */
export async function waitForScreenLoaded(page: Page): Promise<void> {
  await page.locator('main').first().waitFor({ state: 'visible' })
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, {
    timeout: 20_000,
  })
  // Mapas y polling pueden mantener la red ocupada: el `catch` evita un falso fallo.
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
}

export interface OverflowReport {
  innerWidth: number
  scrollWidth: number
  bodyScrollWidth: number
  overflows: boolean
  offenders: string[]
  /** Contenedores con scroll horizontal interno (informativo; las tablas son defecto). */
  innerScrollers: { desc: string; hasTable: boolean }[]
}

export async function measureHorizontalOverflow(
  page: Page,
): Promise<OverflowReport> {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth
    const doc = document.documentElement
    const describe = (el: Element) => {
      const cls =
        typeof el.className === 'string'
          ? el.className.trim().split(/\s+/).slice(0, 4).join('.')
          : ''
      const text = (el.textContent ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40)
      return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''} "${text}"`
    }
    const clippedByAncestor = (el: Element) => {
      let parent = el.parentElement
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent)
        if (style.overflowX !== 'visible') return true
        parent = parent.parentElement
      }
      return false
    }
    const offenders: string[] = []
    const innerScrollers: { desc: string; hasTable: boolean }[] = []
    document.querySelectorAll('body *').forEach((el) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      if (
        (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
        el.scrollWidth > el.clientWidth + 1
      ) {
        innerScrollers.push({
          desc: describe(el),
          hasTable: el.querySelector('table') !== null,
        })
      }
      if (
        (rect.right > innerWidth + 0.5 || rect.left < -0.5) &&
        !clippedByAncestor(el) &&
        style.position !== 'fixed' &&
        offenders.length < 6
      ) {
        offenders.push(
          `${describe(el)} [izq ${Math.round(rect.left)}, der ${Math.round(rect.right)}]`,
        )
      }
    })
    return {
      innerWidth,
      scrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflows:
        doc.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
      offenders,
      innerScrollers,
    }
  })
}

export interface ShellReport {
  tabbarVisible: boolean
  tabbarLabels: string[]
  tabbarBottomGap: number | null
  sidebarVisible: boolean
  sidebarWidth: number | null
}

/** Estado del shell de administración (tabbar abajo o sidebar a la izquierda). */
export async function measureAdminShell(page: Page): Promise<ShellReport> {
  return page.evaluate(() => {
    const tabbar = document.querySelector(
      'nav[aria-label="Navegación principal"]',
    )
    const aside = document.querySelector('aside')
    const visible = (el: Element | null) => {
      if (!el) return false
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
    }
    const tabbarRect = tabbar?.getBoundingClientRect()
    return {
      tabbarVisible: visible(tabbar),
      tabbarLabels: tabbar
        ? Array.from(tabbar.querySelectorAll('a, button')).map((el) =>
            (el.textContent ?? '').trim(),
          )
        : [],
      tabbarBottomGap: tabbarRect
        ? Math.round(window.innerHeight - tabbarRect.bottom)
        : null,
      sidebarVisible: visible(aside),
      sidebarWidth: aside
        ? Math.round(aside.getBoundingClientRect().width)
        : null,
    }
  })
}

/** Tablas visibles (con ancho real) dentro de `main`: en móvil no debería haber ninguna. */
export async function visibleTables(page: Page): Promise<number> {
  return page.evaluate(() => {
    return Array.from(
      document.querySelectorAll('main table, main [role="table"]'),
    ).filter((el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
    }).length
  })
}

export interface TouchTarget {
  tag: string
  label: string
  cls: string
  where: string
  width: number
  height: number
  inline: boolean
  covered: boolean
  coveredBy: string
}

/**
 * Mide el área de toque EFECTIVA de cada control interactivo: no el tamaño visible, sino hasta
 * dónde llega el `elementFromPoint` que devuelve al propio control (o a su etiqueta) a partir de
 * su centro, en horizontal y en vertical. Así cuenta el `::after` que agranda el toque (los
 * pseudo-elementos se resuelven en el control que los origina) y descuenta lo que otro elemento
 * tapa.
 */
export async function measureTouchTargets(page: Page): Promise<TouchTarget[]> {
  return page.evaluate(() => {
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
      '[role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], ' +
      '[role="combobox"], [role="menuitem"], [role="option"]'
    const seen = new Set<Element>()
    const results: {
      tag: string
      label: string
      cls: string
      where: string
      width: number
      height: number
      inline: boolean
      covered: boolean
      coveredBy: string
    }[] = []

    const isSrOnly = (el: Element, rect: DOMRect) => {
      const style = getComputedStyle(el)
      return (
        rect.width <= 1 ||
        rect.height <= 1 ||
        style.clip === 'rect(0px, 0px, 0px, 0px)' ||
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        // Entradas auxiliares de Radix (checkbox, switch, select): no se tocan, van ocultas.
        el.getAttribute('aria-hidden') === 'true' ||
        // Los controles deshabilitados no reciben toques (y dejan pasar el clic al contenedor).
        (el as HTMLButtonElement).disabled === true ||
        el.getAttribute('aria-disabled') === 'true' ||
        // Marcadores del mapa (Leaflet): los superpone su propio contenido.
        el.classList.contains('leaflet-marker-icon') ||
        (style.opacity === '0' && style.pointerEvents === 'none')
      )
    }
    const labelOf = (el: Element) => {
      const aria = el.getAttribute('aria-label')
      if (aria) return aria
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
      if (text) return text.slice(0, 40)
      return (
        el.getAttribute('placeholder') ??
        el.getAttribute('title') ??
        el.getAttribute('name') ??
        ''
      )
    }
    const whereOf = (el: Element) => {
      const chain: string[] = []
      let parent: Element | null = el.parentElement
      while (parent && chain.length < 3) {
        const slot = parent.getAttribute('data-slot')
        const role = parent.getAttribute('role')
        const aria = parent.getAttribute('aria-label')
        if (
          slot ||
          role ||
          aria ||
          ['HEADER', 'NAV', 'MAIN', 'ASIDE'].includes(parent.tagName)
        ) {
          chain.push(
            `${parent.tagName.toLowerCase()}${slot ? '[' + slot + ']' : ''}${role ? '[role=' + role + ']' : ''}${aria ? '[' + aria + ']' : ''}`,
          )
        }
        parent = parent.parentElement
      }
      return chain.join(' < ')
    }

    const hits = (el: Element, x: number, y: number) => {
      const target = document.elementFromPoint(x, y)
      if (!target) return false
      if (target === el || el.contains(target)) return true
      const label = target.closest('label')
      return label !== null && label.contains(el)
    }

    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (seen.has(el)) continue
      seen.add(el)
      let rect = el.getBoundingClientRect()
      if (isSrOnly(el, rect)) continue
      // Un input oculto bajo una etiqueta (checkbox personalizado): se mide la etiqueta.
      el.scrollIntoView({ block: 'center', inline: 'center' })
      rect = el.getBoundingClientRect()
      const cx = Math.min(
        Math.max(rect.left + rect.width / 2, 1),
        window.innerWidth - 1,
      )
      const cy = Math.min(
        Math.max(rect.top + rect.height / 2, 1),
        window.innerHeight - 1,
      )
      const covered = !hits(el, cx, cy)
      let left = cx
      let right = cx
      let top = cy
      let bottom = cy
      const reach = 60
      if (!covered) {
        while (left > cx - reach && left > 0 && hits(el, left - 1, cy))
          left -= 1
        while (
          right < cx + reach &&
          right < window.innerWidth - 1 &&
          hits(el, right + 1, cy)
        )
          right += 1
        while (top > cy - reach && top > 0 && hits(el, cx, top - 1)) top -= 1
        while (
          bottom < cy + reach &&
          bottom < window.innerHeight - 1 &&
          hits(el, cx, bottom + 1)
        )
          bottom += 1
      }
      const style = getComputedStyle(el)
      results.push({
        tag: el.tagName.toLowerCase(),
        label: labelOf(el),
        cls:
          typeof el.className === 'string'
            ? el.className.trim().split(/\s+/).slice(0, 6).join(' ')
            : '',
        where: whereOf(el),
        width: covered ? 0 : Math.round(right - left + 1),
        height: covered ? 0 : Math.round(bottom - top + 1),
        inline: el.tagName === 'A' && style.display === 'inline',
        covered,
        coveredBy: covered
          ? (() => {
              const top = document.elementFromPoint(cx, cy)
              if (!top) return 'nada (fuera de la ventana)'
              const cls =
                typeof top.className === 'string'
                  ? top.className.trim().split(/\s+/).slice(0, 4).join('.')
                  : ''
              return `${top.tagName.toLowerCase()}${cls ? '.' + cls : ''}`
            })()
          : '',
      })
    }
    return results
  })
}

export interface Finding {
  spec: string
  screen: string
  width: number
  kind: string
  detail: string
  shot?: string
}

function findingsFile(spec: string): string {
  return path.join(CAPTURAS_DIR, `hallazgos-${spec}.jsonl`)
}

/** Registra un hallazgo en `hallazgos-<spec>.jsonl`. */
export function recordFinding(finding: Finding): void {
  mkdirSync(CAPTURAS_DIR, { recursive: true })
  appendFileSync(findingsFile(finding.spec), JSON.stringify(finding) + '\n')
}

/** Captura de página completa con nombre estable: `<pantalla>_<ancho>.png`. */
export async function takeShot(
  page: Page,
  screen: string,
  width: number,
  suffix = '',
): Promise<string> {
  mkdirSync(CAPTURAS_DIR, { recursive: true })
  const slug = screen.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const file = `${slug}${suffix ? '-' + suffix : ''}_${width}.png`
  await page.screenshot({ path: path.join(CAPTURAS_DIR, file), fullPage: true })
  return file
}

/** Simula el área segura de un iPhone con muesca (47 px arriba, 34 px abajo) sobre las variables `--safe-*`. */
export const SAFE_TOP = 47
export const SAFE_BOTTOM = 34

export async function simulateSafeArea(page: Page): Promise<void> {
  await page.addInitScript(
    ({ top, bottom }) => {
      const apply = () => {
        const style = document.createElement('style')
        style.textContent = `html:root{--safe-top:${top}px;--safe-bottom:${bottom}px;--safe-left:0px;--safe-right:0px}`
        document.head.appendChild(style)
      }
      if (document.head) apply()
      else document.addEventListener('DOMContentLoaded', apply)
    },
    { top: SAFE_TOP, bottom: SAFE_BOTTOM },
  )
}

/** Agrupa los objetivos táctiles que no llegan al mínimo (los enlaces en línea de un texto se informan aparte). */
export function smallTargets(targets: TouchTarget[], min = 44): TouchTarget[] {
  return targets.filter(
    (t) => !t.inline && (t.covered || t.width < min || t.height < min),
  )
}

export function describeTarget(t: TouchTarget): string {
  // El barrido se corta a 60 px por lado: 121 significa "121 o más".
  const size = (n: number) => (n >= 121 ? '121+' : String(n))
  return `${t.tag} "${t.label}" ${t.covered ? `tapado por ${t.coveredBy}` : `${size(t.width)}x${size(t.height)}`} (${t.where || 'sin contenedor'}) [${t.cls}]`
}
