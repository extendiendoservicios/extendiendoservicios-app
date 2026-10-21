// tests/e2e-ajustes-reunion/helpers/hoja.ts — P19.12d
//
// Mediciones de la hoja imprimible (P19.12a): una hoja A4 de 210 mm de ancho fijo, de alto múltiplo
// de 297 mm (páginas completas), con el bloque de firmas que no cruza el límite de una página y
// columnas cortas (Fecha, Franja, Inicio, Fin, Horas) de un solo renglón. Todo se mide en el
// navegador con `getBoundingClientRect` respecto de la hoja (`data-testid="print-sheet"`), así que
// no depende de la impresión real ni de la hora de la corrida.

import { expect, type Locator, type Page } from '@playwright/test'

/** Milímetros de una hoja A4 y márgenes de `@page` (print.css). */
export const A4 = { ancho: 210, alto: 297, margen: 15 } as const

/** Encabezados de las columnas que nunca parten su contenido. */
export const COLUMNAS_CORTAS = [
  'Fecha',
  'Franja',
  'Inicio',
  'Fin',
  'Horas',
] as const

export interface MedidaHoja {
  /** Ancho de la hoja en mm (sin la escala de la vista previa). */
  anchoMm: number
  /** Alto de la hoja en mm (sin la escala). */
  altoMm: number
  /** Escala aplicada a la vista previa (1 = sin achicar). */
  escala: number
  /** Posición del bloque de firmas dentro de la hoja, en mm; null si no hay. */
  firmas: { arribaMm: number; abajoMm: number } | null
  /** Celdas de columnas cortas con más de un renglón: «Encabezado fila N: texto». */
  celdasPartidas: string[]
  /** Cantidad de celdas de columnas cortas que se revisaron. */
  celdasRevisadas: number
  /** Rectángulo de la hoja en la ventana, en px de pantalla. */
  izquierdaPx: number
  derechaPx: number
  /** Ancho visible de la ventana. */
  ventanaPx: number
  /** `scrollWidth` del documento. */
  scrollDocumentoPx: number
}

/** Mide la hoja abierta. */
export async function medirHoja(page: Page): Promise<MedidaHoja> {
  return page.evaluate(
    ([cortas]) => {
      const MM = 96 / 25.4
      const hoja = document.querySelector<HTMLElement>(
        '[data-testid="print-sheet"]',
      )
      if (!hoja) throw new Error('No hay hoja imprimible abierta')
      const rect = hoja.getBoundingClientRect()
      // La vista previa achica con `transform: scale()`: se deshace para medir en mm reales.
      const transform = getComputedStyle(hoja).transform
      const escala = transform === 'none' ? 1 : new DOMMatrix(transform).a
      const mm = (px: number) => px / escala / MM

      const firmas = hoja.querySelector<HTMLElement>('[data-print-signatures]')
      let medidaFirmas: { arribaMm: number; abajoMm: number } | null = null
      if (firmas) {
        const f = firmas.getBoundingClientRect()
        medidaFirmas = {
          arribaMm: mm(f.top - rect.top),
          abajoMm: mm(f.bottom - rect.top),
        }
      }

      const partidas: string[] = []
      let revisadas = 0
      for (const tabla of hoja.querySelectorAll('table')) {
        const encabezados = [...tabla.querySelectorAll('thead th')].map((th) =>
          (th.textContent ?? '').trim(),
        )
        const indices = encabezados
          .map((texto, i) => (cortas.includes(texto) ? i : -1))
          .filter((i) => i >= 0)
        tabla.querySelectorAll('tbody tr').forEach((fila, n) => {
          const celdas = [...fila.children] as HTMLElement[]
          // Las filas con celda unida (licencia) tienen menos celdas: sus columnas se corren.
          if (celdas.length !== encabezados.length) return
          for (const i of indices) {
            const celda = celdas[i]
            if (!(celda.textContent ?? '').trim()) continue
            // Renglones reales del texto (la celda se estira con la fila, su alto no sirve).
            const rango = document.createRange()
            rango.selectNodeContents(celda)
            const tops = new Set<number>()
            for (const r of rango.getClientRects()) {
              if (r.width > 0) tops.add(Math.round(r.top / escala / 3))
            }
            revisadas++
            if (tops.size > 1) {
              partidas.push(
                `${encabezados[i]} fila ${n + 1}: «${(celda.textContent ?? '').trim()}» (${tops.size} renglones)`,
              )
            }
          }
        })
      }

      return {
        anchoMm: mm(rect.width),
        altoMm: mm(rect.height),
        escala,
        firmas: medidaFirmas,
        celdasPartidas: partidas,
        celdasRevisadas: revisadas,
        izquierdaPx: rect.left,
        derechaPx: rect.right,
        ventanaPx: document.documentElement.clientWidth,
        scrollDocumentoPx: document.documentElement.scrollWidth,
      }
    },
    [COLUMNAS_CORTAS as readonly string[]] as const,
  )
}

/** El ancho es 210 mm y el alto un múltiplo entero de 297 mm. */
export function expectHojaA4(medida: MedidaHoja): void {
  expect(medida.anchoMm, 'ancho de la hoja (mm)').toBeCloseTo(A4.ancho, 0)
  const paginas = medida.altoMm / A4.alto
  expect(paginas, `alto ${medida.altoMm.toFixed(1)} mm`).toBeGreaterThan(0.99)
  expect(
    Math.abs(paginas - Math.round(paginas)) * A4.alto,
    `el alto (${medida.altoMm.toFixed(1)} mm) es múltiplo de 297 mm`,
  ).toBeLessThan(0.6)
}

/** El bloque de firmas está entero dentro del alto útil (297 − 2×15 mm) de una misma página. */
export function expectFirmasSinCruzar(medida: MedidaHoja): void {
  expect(medida.firmas, 'hay bloque de firmas').not.toBeNull()
  const { arribaMm, abajoMm } = medida.firmas!
  const pagina = Math.floor((arribaMm + 0.01) / A4.alto)
  const limiteInferior = pagina * A4.alto + A4.alto - A4.margen
  expect(
    abajoMm,
    `las firmas (${arribaMm.toFixed(1)}–${abajoMm.toFixed(1)} mm) cruzan el fondo útil de la página ${pagina + 1} (${limiteInferior} mm)`,
  ).toBeLessThanOrEqual(limiteInferior + 0.6)
  expect(
    abajoMm - arribaMm,
    'el bloque de firmas entra en el alto útil de una página',
  ).toBeLessThanOrEqual(A4.alto - 2 * A4.margen)
}

/** Ninguna celda de las columnas cortas parte su contenido en más de un renglón. */
export function expectColumnasCortasEnUnRenglon(medida: MedidaHoja): void {
  expect(
    medida.celdasRevisadas,
    'hay celdas cortas para revisar',
  ).toBeGreaterThan(0)
  expect(medida.celdasPartidas, 'celdas de columnas cortas partidas').toEqual(
    [],
  )
}

/** La hoja (achicada) entra en el ancho de la ventana y la página no tiene scroll horizontal. */
export function expectHojaEntraEnPantalla(medida: MedidaHoja): void {
  expect(
    medida.izquierdaPx,
    'borde izquierdo de la hoja',
  ).toBeGreaterThanOrEqual(-0.5)
  expect(
    medida.derechaPx,
    `borde derecho de la hoja (${medida.derechaPx.toFixed(1)} px) dentro de la ventana (${medida.ventanaPx} px)`,
  ).toBeLessThanOrEqual(medida.ventanaPx + 0.5)
  expect(medida.escala, 'la hoja se achicó para entrar').toBeLessThan(1)
  expect(medida.scrollDocumentoPx).toBeLessThanOrEqual(medida.ventanaPx)
}

/**
 * Agrega al final de la tabla `n` copias de la primera fila de datos (solo en el DOM de la vista
 * previa, nada se guarda) para empujar las firmas hacia el límite de página. Devuelve cuántas filas
 * hay después.
 */
export async function agregarFilasDeRelleno(
  hoja: Locator,
  cantidad: number,
): Promise<void> {
  await hoja.evaluate((nodo, n) => {
    const cuerpo = nodo.querySelector('table tbody')
    const modelo = cuerpo?.querySelector('tr:not(:has(td[colspan]))')
    if (!cuerpo || !modelo) throw new Error('No hay fila para copiar')
    for (let i = 0; i < n; i++) cuerpo.append(modelo.cloneNode(true))
  }, cantidad)
}
