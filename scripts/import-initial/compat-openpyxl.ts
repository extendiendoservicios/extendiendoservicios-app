// scripts/import-initial/compat-openpyxl.ts — DATA-005
//
// `docs/plantilla-carga-inicial.xlsx` la genera openpyxl (Python), que guarda las notas de las
// celdas con otros nombres y rutas que Excel: `xl/comments/commentN.xml` y
// `xl/drawings/commentsDrawingN.vml`, con rutas absolutas en las relaciones. `exceljs` solo
// reconoce los nombres de Excel (`xl/commentsN.xml`, `xl/drawings/vmlDrawingN.vml`, rutas
// relativas) y se cae al abrir esos archivos ("Cannot read properties of undefined (reading
// 'comments')"). Los archivos que la empresa guarda con Excel no tienen el problema.
//
// Esto reescribe el .xlsx (un zip) renombrando esas dos partes y sus relaciones, para que
// `leerPlantilla` pueda abrir también la plantilla original sin pasar por Excel. Sin
// dependencias: usa `node:zlib` (inflate/deflate y CRC-32). Solo se usa como reintento cuando
// la lectura normal falla.

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

interface Parte {
  nombre: string
  datos: Buffer
}

function leerZip(zip: Buffer): Parte[] {
  // Registro de fin del directorio central (firma 0x06054b50), buscado desde el final.
  let fin = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fin = i
      break
    }
  }
  if (fin < 0) throw new Error('No es un archivo zip válido.')
  const cantidad = zip.readUInt16LE(fin + 10)
  let cursor = zip.readUInt32LE(fin + 16)
  const partes: Parte[] = []
  for (let n = 0; n < cantidad; n++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Directorio central del zip dañado.')
    }
    const metodo = zip.readUInt16LE(cursor + 10)
    const tamanoComprimido = zip.readUInt32LE(cursor + 20)
    const largoNombre = zip.readUInt16LE(cursor + 28)
    const largoExtra = zip.readUInt16LE(cursor + 30)
    const largoComentario = zip.readUInt16LE(cursor + 32)
    const desplazamientoLocal = zip.readUInt32LE(cursor + 42)
    const nombre = zip.toString('utf8', cursor + 46, cursor + 46 + largoNombre)
    cursor += 46 + largoNombre + largoExtra + largoComentario

    const localNombre = zip.readUInt16LE(desplazamientoLocal + 26)
    const localExtra = zip.readUInt16LE(desplazamientoLocal + 28)
    const inicio = desplazamientoLocal + 30 + localNombre + localExtra
    const comprimido = zip.subarray(inicio, inicio + tamanoComprimido)
    if (metodo !== 0 && metodo !== 8) {
      throw new Error(`Método de compresión no soportado (${metodo}).`)
    }
    partes.push({
      nombre,
      datos:
        metodo === 8 ? inflateRawSync(comprimido) : Buffer.from(comprimido),
    })
  }
  return partes
}

function escribirZip(partes: Parte[]): Buffer {
  const locales: Buffer[] = []
  const centrales: Buffer[] = []
  let desplazamiento = 0
  for (const parte of partes) {
    const nombre = Buffer.from(parte.nombre, 'utf8')
    const comprimido = deflateRawSync(parte.datos)
    const crc = crc32(parte.datos)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versión necesaria
    local.writeUInt16LE(0x0800, 6) // nombre en UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comprimido.length, 18)
    local.writeUInt32LE(parte.datos.length, 22)
    local.writeUInt16LE(nombre.length, 26)
    locales.push(local, nombre, comprimido)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(comprimido.length, 20)
    central.writeUInt32LE(parte.datos.length, 24)
    central.writeUInt16LE(nombre.length, 28)
    central.writeUInt32LE(desplazamiento, 42)
    centrales.push(central, nombre)

    desplazamiento += local.length + nombre.length + comprimido.length
  }
  const tamanoCentral = centrales.reduce((a, b) => a + b.length, 0)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(partes.length, 8)
  fin.writeUInt16LE(partes.length, 10)
  fin.writeUInt32LE(tamanoCentral, 12)
  fin.writeUInt32LE(desplazamiento, 16)
  return Buffer.concat([...locales, ...centrales, fin])
}

/** Renombra las notas de celda de openpyxl al formato que reconoce `exceljs`. */
export function normalizarNotasDeOpenpyxl(zip: Buffer): Buffer {
  const partes = leerZip(zip).map((parte): Parte => {
    let nombre = parte.nombre
    nombre = nombre.replace(
      /^xl\/comments\/comment(\d+)\.xml$/,
      'xl/comments$1.xml',
    )
    nombre = nombre.replace(
      /^xl\/drawings\/commentsDrawing(\d+)\.vml$/,
      'xl/drawings/vmlDrawing$1.vml',
    )
    if (/^xl\/worksheets\/_rels\/.+\.rels$/.test(nombre)) {
      const texto = parte.datos
        .toString('utf8')
        .replace(
          /Target="\/xl\/comments\/comment(\d+)\.xml"/g,
          'Target="../comments$1.xml"',
        )
        .replace(
          /Target="\/xl\/drawings\/commentsDrawing(\d+)\.vml"/g,
          'Target="../drawings/vmlDrawing$1.vml"',
        )
      return { nombre, datos: Buffer.from(texto, 'utf8') }
    }
    return { nombre, datos: parte.datos }
  })
  return escribirZip(partes)
}
