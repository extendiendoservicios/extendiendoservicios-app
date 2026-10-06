// scripts/import-initial/leer-plantilla.ts — DATA-003
//
// Lee el Excel de la carga inicial con `exceljs` y lo deja como filas con valores por campo. No
// interpreta datos: solo ubica las hojas y los encabezados (aunque la empresa haya movido o
// agregado columnas), descarta filas vacías y el renglón separador, y marca las filas de ejemplo
// de la plantilla para ignorarlas. La validación de cada dato es de `validar.ts`.
//
// Una fila es de ejemplo si tiene la palabra "Ejemplo" en cualquier celda, o si tiene el relleno
// amarillo de la plantilla y está arriba del renglón separador ("Borrá la fila de ejemplo...").
// Las ignoradas quedan en el informe con su número de fila, para que se vea qué se descartó.

import { readFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import { normalizarNotasDeOpenpyxl } from './compat-openpyxl.ts'
import { ESQUEMA } from './esquema.ts'
import { claveSinTildes } from './normalizar.ts'
import {
  NOMBRES_HOJAS,
  type Celda,
  type FilaLeida,
  type HojaLeida,
  type Incidencia,
  type LecturaPlantilla,
  type NombreHoja,
} from './tipos.ts'

const FILAS_A_BUSCAR_ENCABEZADO = 10
const RELLENO_EJEMPLO = 'FDF3E0'

/** Desenvuelve texto enriquecido, hipervínculos y fórmulas. */
function valorDeCelda(valor: ExcelJS.CellValue | undefined): Celda {
  if (valor === null || valor === undefined) return null
  if (
    typeof valor === 'string' ||
    typeof valor === 'number' ||
    typeof valor === 'boolean' ||
    valor instanceof Date
  ) {
    return valor
  }
  if ('richText' in valor) return valor.richText.map((t) => t.text).join('')
  if ('error' in valor) return String(valor.error)
  if ('result' in valor) return valorDeCelda(valor.result)
  if ('text' in valor) {
    return typeof valor.text === 'string'
      ? valor.text
      : valorDeCelda(valor.text)
  }
  return null
}

function encabezadoNorm(valor: Celda): string {
  if (valor === null) return ''
  const t =
    typeof valor === 'string'
      ? valor
      : valor instanceof Date
        ? ''
        : String(valor)
  return claveSinTildes(t.replace(/\(\*\)/g, ''))
}

function esSeparador(valores: Celda[]): boolean {
  return valores.some(
    (v) =>
      typeof v === 'string' &&
      claveSinTildes(v).startsWith('borra la fila de ejemplo'),
  )
}

function tieneRellenoDeEjemplo(fila: ExcelJS.Row, columnas: number): boolean {
  for (let i = 1; i <= columnas; i++) {
    const relleno = fila.getCell(i).fill
    if (
      relleno &&
      relleno.type === 'pattern' &&
      relleno.fgColor?.argb?.toUpperCase().endsWith(RELLENO_EJEMPLO)
    ) {
      return true
    }
  }
  return false
}

function leerHoja(
  ws: ExcelJS.Worksheet,
  nombre: NombreHoja,
  incidencias: Incidencia[],
): HojaLeida {
  const esquema = ESQUEMA[nombre]
  // Se aceptan el título actual (versión 2) y los anteriores (plantilla de septiembre).
  const esperados = new Map(
    esquema.flatMap((col) =>
      [col.titulo, ...col.alias].map((t) => [claveSinTildes(t), col] as const),
    ),
  )

  // Fila de encabezados: la que más títulos esperados tenga entre las primeras filas.
  let filaEncabezado = 0
  let mejor = 0
  for (let n = 1; n <= Math.min(FILAS_A_BUSCAR_ENCABEZADO, ws.rowCount); n++) {
    const fila = ws.getRow(n)
    let aciertos = 0
    for (let i = 1; i <= ws.columnCount; i++) {
      if (esperados.has(encabezadoNorm(valorDeCelda(fila.getCell(i).value)))) {
        aciertos++
      }
    }
    if (aciertos > mejor) {
      mejor = aciertos
      filaEncabezado = n
    }
  }
  if (filaEncabezado === 0 || mejor < Math.min(2, esquema.length)) {
    incidencias.push({
      nivel: 'error',
      hoja: nombre,
      fila: null,
      columna: null,
      codigo: 'ENCABEZADOS_NO_ENCONTRADOS',
      mensaje:
        'No encontramos los títulos de las columnas en las primeras filas de la hoja. Usá la plantilla original sin cambiar los títulos.',
    })
    return { nombre, encontrada: true, filas: [] }
  }

  // Columna de Excel -> campo.
  const campoPorColumna = new Map<number, string>()
  const encontrados = new Set<string>()
  const filaTitulos = ws.getRow(filaEncabezado)
  for (let i = 1; i <= ws.columnCount; i++) {
    const norm = encabezadoNorm(valorDeCelda(filaTitulos.getCell(i).value))
    const col = esperados.get(norm)
    if (col && !encontrados.has(col.campo)) {
      campoPorColumna.set(i, col.campo)
      encontrados.add(col.campo)
    }
  }
  for (const col of esquema) {
    if (encontrados.has(col.campo)) continue
    incidencias.push({
      nivel: col.obligatoria ? 'error' : 'advertencia',
      hoja: nombre,
      fila: filaEncabezado,
      columna: col.titulo,
      codigo: 'COLUMNA_FALTA',
      mensaje: col.obligatoria
        ? `Falta la columna "${col.titulo}" en la hoja. Usá la plantilla original.`
        : `Falta la columna "${col.titulo}": se toma como vacía en todas las filas.`,
    })
  }

  // Renglón separador ("Borrá la fila de ejemplo..."): marca dónde empiezan los datos reales.
  let filaSeparador: number | null = null
  for (let n = filaEncabezado + 1; n <= ws.rowCount; n++) {
    const valores: Celda[] = []
    for (let i = 1; i <= ws.columnCount; i++) {
      valores.push(valorDeCelda(ws.getRow(n).getCell(i).value))
    }
    if (esSeparador(valores)) {
      filaSeparador = n
      break
    }
  }

  const filas: FilaLeida[] = []
  for (let n = filaEncabezado + 1; n <= ws.rowCount; n++) {
    if (n === filaSeparador) continue
    const fila = ws.getRow(n)
    const celdas: Record<string, Celda> = {}
    let conDatos = false
    let dicePalabraEjemplo = false
    for (const [indice, campo] of campoPorColumna) {
      const valor = valorDeCelda(fila.getCell(indice).value)
      const limpio =
        typeof valor === 'string' && valor.trim() === '' ? null : valor
      celdas[campo] = limpio
      if (limpio !== null) conDatos = true
      if (typeof limpio === 'string' && /\bejemplo\b/i.test(limpio)) {
        dicePalabraEjemplo = true
      }
    }
    if (!conDatos) continue

    const arribaDelSeparador = filaSeparador !== null && n < filaSeparador
    if (
      dicePalabraEjemplo ||
      (arribaDelSeparador && tieneRellenoDeEjemplo(fila, ws.columnCount))
    ) {
      incidencias.push({
        nivel: 'ignorada',
        hoja: nombre,
        fila: n,
        columna: null,
        codigo: 'FILA_DE_EJEMPLO',
        mensaje:
          'Es una fila de ejemplo de la plantilla: se ignora. Si es un dato real, sacale la palabra "Ejemplo" y el fondo amarillo.',
      })
      continue
    }
    filas.push({ fila: n, celdas: celdas })
  }

  return { nombre, encontrada: true, filas }
}

async function cargarLibro(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  return libro
}

/**
 * Abre el libro. Si `exceljs` se cae con un archivo generado por openpyxl (como la plantilla
 * original, ver `compat-openpyxl.ts`), reintenta con las notas de celda renombradas; si tampoco
 * así abre, informa el error de la primera lectura.
 */
async function abrirLibro(buffer: Buffer): Promise<ExcelJS.Workbook> {
  try {
    return await cargarLibro(buffer)
  } catch (primero) {
    try {
      return await cargarLibro(normalizarNotasDeOpenpyxl(buffer))
    } catch {
      throw primero
    }
  }
}

/** Lee la planilla desde un archivo o desde un buffer en memoria. */
export async function leerPlantilla(
  origen: string | Buffer,
): Promise<LecturaPlantilla> {
  const incidencias: Incidencia[] = []
  let libro: ExcelJS.Workbook
  try {
    libro = await abrirLibro(
      typeof origen === 'string' ? await readFile(origen) : origen,
    )
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    incidencias.push({
      nivel: 'error',
      hoja: 'Archivo',
      fila: null,
      columna: null,
      codigo: 'ARCHIVO_ILEGIBLE',
      mensaje: `No se pudo abrir el archivo como planilla de Excel (.xlsx): ${detalle}`,
    })
    return {
      hojas: Object.fromEntries(
        NOMBRES_HOJAS.map((n) => [
          n,
          { nombre: n, encontrada: false, filas: [] },
        ]),
      ) as unknown as Record<NombreHoja, HojaLeida>,
      incidencias,
    }
  }

  const hojas = {} as Record<NombreHoja, HojaLeida>
  let encontradas = 0
  for (const nombre of NOMBRES_HOJAS) {
    const ws = libro.worksheets.find(
      (h) => claveSinTildes(h.name) === claveSinTildes(nombre),
    )
    if (!ws) {
      hojas[nombre] = { nombre, encontrada: false, filas: [] }
      continue
    }
    encontradas++
    hojas[nombre] = leerHoja(ws, nombre, incidencias)
  }

  if (encontradas === 0) {
    incidencias.push({
      nivel: 'error',
      hoja: 'Archivo',
      fila: null,
      columna: null,
      codigo: 'SIN_HOJAS',
      mensaje:
        'El archivo no tiene ninguna de las hojas de la plantilla (Clientes, Empleados, etc.). ¿Es el archivo correcto?',
    })
  } else {
    for (const nombre of NOMBRES_HOJAS) {
      if (hojas[nombre].encontrada) continue
      incidencias.push({
        nivel: 'advertencia',
        hoja: 'Archivo',
        fila: null,
        columna: null,
        codigo: 'HOJA_FALTA',
        mensaje: `No encontramos la hoja "${nombre}": se toma como vacía.`,
      })
    }
  }
  return { hojas, incidencias }
}
