/**
 * Arma un JPEG mínimo con EXIF para los tests de `src/lib/media`: sin datos
 * de imagen reales, solo la estructura que lee `readJpegMeta` (APP1 con
 * orientación y fecha, SOF0 con el tamaño crudo, SOS y EOI).
 */

export interface JpegFixtureOptions {
  /** Orientación EXIF 1 a 8. Si falta, no se escribe la etiqueta. */
  orientation?: number
  /** `DateTimeOriginal`, p. ej. `"2026:10:13 08:15:30"`. */
  dateTimeOriginal?: string
  /** `OffsetTimeOriginal`, p. ej. `"-03:00"`. */
  offsetTimeOriginal?: string
  /** Tamaño crudo guardado en el SOF0. */
  width?: number
  height?: number
  /** Big-endian (`MM`) en vez de little-endian (`II`). */
  bigEndian?: boolean
}

export function buildJpeg(options: JpegFixtureOptions = {}): Uint8Array {
  const {
    orientation,
    dateTimeOriginal,
    offsetTimeOriginal,
    width = 4000,
    height = 3000,
    bigEndian = false,
  } = options
  const little = !bigEndian

  const tiff = new Uint8Array(512)
  const view = new DataView(tiff.buffer)
  const u16 = (o: number, v: number) => view.setUint16(o, v, little)
  const u32 = (o: number, v: number) => view.setUint32(o, v, little)

  tiff[0] = little ? 0x49 : 0x4d
  tiff[1] = little ? 0x49 : 0x4d
  u16(2, 42)
  u32(4, 8)

  // IFD0 en 8: orientación (opcional) + puntero al Exif IFD.
  const hasExifIfd = dateTimeOriginal !== undefined
  const ifd0Entries = (orientation !== undefined ? 1 : 0) + (hasExifIfd ? 1 : 0)
  let p = 8
  u16(p, ifd0Entries)
  p += 2
  if (orientation !== undefined) {
    u16(p, 0x0112)
    u16(p + 2, 3)
    u32(p + 4, 1)
    u16(p + 8, orientation)
    p += 12
  }
  const exifIfdOffset = 8 + 2 + ifd0Entries * 12 + 4
  if (hasExifIfd) {
    u16(p, 0x8769)
    u16(p + 2, 4)
    u32(p + 4, 1)
    u32(p + 8, exifIfdOffset)
    p += 12
  }
  u32(p, 0)

  let end = exifIfdOffset
  if (hasExifIfd) {
    const entries = offsetTimeOriginal !== undefined ? 2 : 1
    const dataStart = exifIfdOffset + 2 + entries * 12 + 4
    u16(exifIfdOffset, entries)
    let e = exifIfdOffset + 2
    const text = `${dateTimeOriginal}\0`
    u16(e, 0x9003)
    u16(e + 2, 2)
    u32(e + 4, text.length)
    u32(e + 8, dataStart)
    for (let i = 0; i < text.length; i++)
      tiff[dataStart + i] = text.charCodeAt(i)
    end = dataStart + text.length
    e += 12
    if (offsetTimeOriginal !== undefined) {
      const offsetText = `${offsetTimeOriginal}\0`
      u16(e, 0x9011)
      u16(e + 2, 2)
      u32(e + 4, offsetText.length)
      u32(e + 8, end)
      for (let i = 0; i < offsetText.length; i++) {
        tiff[end + i] = offsetText.charCodeAt(i)
      }
      end += offsetText.length
      e += 12
    }
    u32(e, 0)
  }
  const tiffBytes = tiff.slice(0, end)

  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0, 0]
  const app1Length = 2 + exifHeader.length + tiffBytes.length
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ]

  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (app1Length >> 8) & 0xff,
    app1Length & 0xff,
    ...exifHeader,
    ...tiffBytes,
    ...sof,
    0xff,
    0xda,
    0x00,
    0x02,
    0xff,
    0xd9,
  ])
}
