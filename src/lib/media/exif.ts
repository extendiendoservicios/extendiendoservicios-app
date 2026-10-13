/**
 * Lectura mínima de los metadatos de un JPEG (módulo H, `compressImage`).
 *
 * Hace falta SOLO para dos datos que se pierden al redibujar la foto en un
 * canvas: la orientación EXIF y la fecha en que se sacó (`captured_at`).
 * También lee el tamaño «crudo» guardado en el JPEG, para saber si el
 * navegador ya aplicó la orientación al decodificar. No es un lector EXIF
 * general ni se agregó una librería para esto (ver `docs/design-system.md`).
 */

export interface JpegMeta {
  /** Valor EXIF 1 a 8; 1 si no hay dato. */
  orientation: number
  /** Fecha de la toma, o `null` si el archivo no la trae. */
  capturedAt: Date | null
  /** Tamaño guardado en el JPEG, sin aplicar la orientación. */
  width: number | null
  height: number | null
}

/**
 * El EXIF no guarda zona horaria (salvo `OffsetTimeOriginal`, que casi
 * ningún celular escribe). Se asume la zona del negocio, Buenos Aires
 * (UTC-3, sin horario de verano), igual que el resto de la app.
 */
const DEFAULT_OFFSET = '-03:00'

const EMPTY: JpegMeta = {
  orientation: 1,
  capturedAt: null,
  width: null,
  height: null,
}

export function readJpegMeta(buffer: ArrayBuffer): JpegMeta {
  try {
    return parse(new DataView(buffer))
  } catch {
    // Un EXIF roto no tiene que impedir subir la foto.
    return { ...EMPTY }
  }
}

function parse(view: DataView): JpegMeta {
  const meta: JpegMeta = { ...EMPTY }
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return meta

  let offset = 2
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break
    const marker = view.getUint8(offset + 1)
    if (marker === 0xff) {
      offset += 1
      continue
    }
    // Marcadores sin largo.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 1) {
      offset += 2
      continue
    }
    if (marker === 0xda) break // Comienzo de los datos de imagen.
    const length = view.getUint16(offset + 2)
    const start = offset + 4

    if (marker === 0xe1 && isExifHeader(view, start)) {
      readExif(view, start + 6, meta)
    } else if (isStartOfFrame(marker) && start + 5 <= view.byteLength) {
      meta.height = view.getUint16(start + 1)
      meta.width = view.getUint16(start + 3)
    }
    offset += 2 + length
  }
  return meta
}

function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  )
}

function isExifHeader(view: DataView, start: number): boolean {
  return (
    start + 6 <= view.byteLength &&
    view.getUint32(start) === 0x45786966 && // "Exif"
    view.getUint16(start + 4) === 0
  )
}

function readExif(view: DataView, tiff: number, meta: JpegMeta): void {
  const little = view.getUint16(tiff) === 0x4949 // "II"
  const u16 = (o: number) => view.getUint16(tiff + o, little)
  const u32 = (o: number) => view.getUint32(tiff + o, little)

  let dateTime: string | null = null
  let dateOriginal: string | null = null
  let offsetOriginal: string | null = null
  let exifIfd = 0

  const ascii = (entry: number): string | null => {
    const count = u32(entry + 4)
    const at = count > 4 ? u32(entry + 8) : entry + 8
    if (tiff + at + count > view.byteLength) return null
    let text = ''
    for (let i = 0; i < count; i++) {
      const c = view.getUint8(tiff + at + i)
      if (c === 0) break
      text += String.fromCharCode(c)
    }
    return text
  }

  const walk = (ifd: number, onTag: (tag: number, entry: number) => void) => {
    if (ifd <= 0 || tiff + ifd + 2 > view.byteLength) return
    const entries = u16(ifd)
    for (let i = 0; i < entries; i++) {
      const entry = ifd + 2 + i * 12
      if (tiff + entry + 12 > view.byteLength) return
      onTag(u16(entry), entry)
    }
  }

  walk(u32(4), (tag, entry) => {
    if (tag === 0x0112) {
      const value = u16(entry + 8)
      if (value >= 1 && value <= 8) meta.orientation = value
    } else if (tag === 0x0132) {
      dateTime = ascii(entry)
    } else if (tag === 0x8769) {
      exifIfd = u32(entry + 8)
    }
  })

  walk(exifIfd, (tag, entry) => {
    if (tag === 0x9003) dateOriginal = ascii(entry)
    else if (tag === 0x9011) offsetOriginal = ascii(entry)
    else if (tag === 0x9004 && dateTime === null) dateTime = ascii(entry)
  })

  meta.capturedAt = parseExifDate(dateOriginal ?? dateTime, offsetOriginal)
}

/** `"2026:10:13 08:15:30"` (+ `"-03:00"` opcional) a `Date`. */
export function parseExifDate(
  value: string | null,
  offset: string | null = null,
): Date | null {
  if (!value) return null
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    value,
  )
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match
  if (y === '0000') return null
  const zone =
    offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : DEFAULT_OFFSET
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Cómo dibujar una imagen para que quede derecha. Devuelve el tamaño del
 * canvas de salida y la matriz `[a, b, c, d, e, f]` de `ctx.setTransform`,
 * para una imagen guardada de `width` × `height` con esa orientación EXIF.
 */
export function orientationTransform(
  orientation: number,
  width: number,
  height: number,
): {
  width: number
  height: number
  matrix: [number, number, number, number, number, number]
} {
  switch (orientation) {
    case 2:
      return { width, height, matrix: [-1, 0, 0, 1, width, 0] }
    case 3:
      return { width, height, matrix: [-1, 0, 0, -1, width, height] }
    case 4:
      return { width, height, matrix: [1, 0, 0, -1, 0, height] }
    case 5:
      return { width: height, height: width, matrix: [0, 1, 1, 0, 0, 0] }
    case 6:
      return { width: height, height: width, matrix: [0, 1, -1, 0, height, 0] }
    case 7:
      return {
        width: height,
        height: width,
        matrix: [0, -1, -1, 0, height, width],
      }
    case 8:
      return { width: height, height: width, matrix: [0, -1, 1, 0, 0, width] }
    default:
      return { width, height, matrix: [1, 0, 0, 1, 0, 0] }
  }
}
