import { describe, expect, it } from 'vitest'
import { buildJpeg } from '@/test/jpegFixture'
import { orientationTransform, parseExifDate, readJpegMeta } from './exif'

function meta(bytes: Uint8Array) {
  return readJpegMeta(bytes.buffer.slice(0) as ArrayBuffer)
}

describe('readJpegMeta', () => {
  it('lee orientación, fecha y tamaño crudo (little-endian)', () => {
    const result = meta(
      buildJpeg({
        orientation: 6,
        dateTimeOriginal: '2026:10:13 08:15:30',
        width: 4032,
        height: 3024,
      }),
    )
    expect(result.orientation).toBe(6)
    expect(result.width).toBe(4032)
    expect(result.height).toBe(3024)
    // Sin offset en el archivo: se asume Buenos Aires (UTC-3).
    expect(result.capturedAt?.toISOString()).toBe('2026-10-13T11:15:30.000Z')
  })

  it('también lee big-endian', () => {
    const result = meta(
      buildJpeg({
        bigEndian: true,
        orientation: 8,
        dateTimeOriginal: '2026:01:02 03:04:05',
      }),
    )
    expect(result.orientation).toBe(8)
    expect(result.capturedAt?.toISOString()).toBe('2026-01-02T06:04:05.000Z')
  })

  it('respeta OffsetTimeOriginal si el archivo lo trae', () => {
    const result = meta(
      buildJpeg({
        dateTimeOriginal: '2026:10:13 08:00:00',
        offsetTimeOriginal: '+02:00',
      }),
    )
    expect(result.capturedAt?.toISOString()).toBe('2026-10-13T06:00:00.000Z')
  })

  it('sin EXIF devuelve orientación 1 y sin fecha', () => {
    const result = meta(buildJpeg({}))
    expect(result.orientation).toBe(1)
    expect(result.capturedAt).toBeNull()
    expect(result.width).toBe(4000)
  })

  it('un archivo que no es JPEG o está cortado no explota', () => {
    expect(meta(new Uint8Array([1, 2, 3, 4, 5])).orientation).toBe(1)
    const cut = buildJpeg({
      orientation: 6,
      dateTimeOriginal: '2026:10:13 08:15:30',
    })
    expect(meta(cut.slice(0, 20)).capturedAt).toBeNull()
  })
})

describe('parseExifDate', () => {
  it('rechaza formatos inválidos y fechas imposibles', () => {
    expect(parseExifDate(null)).toBeNull()
    expect(parseExifDate('ayer')).toBeNull()
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull()
    expect(parseExifDate('2026:13:40 99:00:00')).toBeNull()
  })
})

describe('orientationTransform', () => {
  const W = 4
  const H = 2

  it('1 no cambia nada y 5 a 8 intercambian los ejes', () => {
    expect(orientationTransform(1, W, H)).toMatchObject({ width: W, height: H })
    for (const o of [2, 3, 4]) {
      expect(orientationTransform(o, W, H)).toMatchObject({
        width: W,
        height: H,
      })
    }
    for (const o of [5, 6, 7, 8]) {
      expect(orientationTransform(o, W, H)).toMatchObject({
        width: H,
        height: W,
      })
    }
  })

  it('cada orientación deja las cuatro esquinas dentro del lienzo de salida', () => {
    for (let o = 1; o <= 8; o++) {
      const { width, height, matrix } = orientationTransform(o, W, H)
      const [a, b, c, d, e, f] = matrix
      for (const [x, y] of [
        [0, 0],
        [W, 0],
        [0, H],
        [W, H],
      ] as const) {
        const tx = a * x + c * y + e
        const ty = b * x + d * y + f
        expect(tx).toBeGreaterThanOrEqual(0)
        expect(tx).toBeLessThanOrEqual(width)
        expect(ty).toBeGreaterThanOrEqual(0)
        expect(ty).toBeLessThanOrEqual(height)
      }
    }
  })

  it('la 6 (celular vertical) manda la esquina superior izquierda a la superior derecha', () => {
    const { matrix } = orientationTransform(6, W, H)
    const [a, b, c, d, e, f] = matrix
    expect([a * 0 + c * 0 + e, b * 0 + d * 0 + f]).toEqual([H, 0])
  })
})
