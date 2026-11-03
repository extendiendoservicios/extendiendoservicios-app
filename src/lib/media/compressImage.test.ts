// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildJpeg } from '@/test/jpegFixture'
import { compressImage } from './compressImage'
import { MediaError } from './errors'

/**
 * jsdom no decodifica ni dibuja imágenes: se simulan `Image` (con el tamaño
 * que decodificaría el navegador) y el canvas (`getContext` y `toBlob`, con
 * un tamaño de salida que depende de la calidad pedida).
 */

interface Drawn {
  width: number
  height: number
  quality: number | undefined
}

let imageSize = { width: 4000, height: 3000 }
let imageFails = false
let bytesForQuality: (quality: number | undefined, canvas: Drawn) => number
let blobs: Drawn[] = []
let transforms: number[][] = []

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  set src(_value: string) {
    queueMicrotask(() => {
      if (imageFails) {
        this.onerror?.()
        return
      }
      this.naturalWidth = imageSize.width
      this.naturalHeight = imageSize.height
      this.onload?.()
    })
  }
}

function jpegFile(
  options: Parameters<typeof buildJpeg>[0] = {},
  name = 'a.jpg',
) {
  return new File([buildJpeg(options).slice().buffer], name, {
    type: 'image/jpeg',
    lastModified: Date.UTC(2026, 9, 12, 12, 0, 0),
  })
}

beforeEach(() => {
  imageSize = { width: 4000, height: 3000 }
  imageFails = false
  blobs = []
  transforms = []
  bytesForQuality = (_quality, canvas) =>
    canvas.width > 320 || canvas.height > 320 ? 150 * 1024 : 20 * 1024

  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:fake'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        setTransform: vi.fn((...args: number[]) => transforms.push(args)),
        imageSmoothingQuality: 'low',
        fillStyle: '',
      }) as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    const drawn = { width: this.width, height: this.height, quality }
    blobs.push(drawn)
    callback(
      new Blob([new Uint8Array(bytesForQuality(quality, drawn))], {
        type: type ?? 'image/jpeg',
      }),
    )
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('compressImage: tamaños y proporciones', () => {
  it('foto horizontal de 4000×3000: 1280×960 y miniatura de 320×240', async () => {
    const result = await compressImage(jpegFile())
    expect(result).toMatchObject({
      kind: 'photo',
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: 1280,
      height: 960,
      durationSeconds: null,
    })
    const thumb = blobs.at(-1)
    expect(thumb).toMatchObject({ width: 320, height: 240 })
    expect(result.bytes).toBe(150 * 1024)
    expect(result.thumbnailBytes).toBe(20 * 1024)
    expect(result.totalBytes).toBe(result.bytes + result.thumbnailBytes)
  })

  it('foto vertical de 3000×4000: 960×1280 y miniatura de 240×320', async () => {
    imageSize = { width: 3000, height: 4000 }
    const result = await compressImage(jpegFile())
    expect([result.width, result.height]).toEqual([960, 1280])
    expect(blobs.at(-1)).toMatchObject({ width: 240, height: 320 })
  })

  it('no agranda una foto que ya es chica', async () => {
    imageSize = { width: 800, height: 600 }
    const result = await compressImage(jpegFile())
    expect([result.width, result.height]).toEqual([800, 600])
    expect(blobs.at(-1)).toMatchObject({ width: 320, height: 240 })
  })

  it('pide JPEG con calidad 0,72 cuando entra en 300 KB', async () => {
    await compressImage(jpegFile())
    expect(blobs[0]?.quality).toBe(0.72)
    // Un solo intento para la foto y uno para la miniatura.
    expect(blobs).toHaveLength(2)
  })
})

describe('compressImage: baja de calidad', () => {
  it('si pasa de 300 KB, baja la calidad por pasos hasta que entra', async () => {
    const sizes = new Map<number, number>([
      [0.72, 420 * 1024],
      [0.64, 330 * 1024],
      [0.56, 280 * 1024],
    ])
    bytesForQuality = (quality, canvas) =>
      canvas.width <= 320 ? 20 * 1024 : (sizes.get(quality ?? 0) ?? 100)
    const result = await compressImage(jpegFile())
    expect(blobs.slice(0, 3).map((b) => b.quality)).toEqual([0.72, 0.64, 0.56])
    expect(result.bytes).toBe(280 * 1024)
  })

  it('si ningún paso alcanza, se queda con el último en vez de fallar', async () => {
    bytesForQuality = (_q, canvas) =>
      canvas.width <= 320 ? 20 * 1024 : 900 * 1024
    const result = await compressImage(jpegFile())
    expect(result.bytes).toBe(900 * 1024)
    expect(blobs.filter((b) => b.width > 320)).toHaveLength(5)
  })
})

describe('compressImage: orientación EXIF', () => {
  it('el navegador ya la aplicó (tamaño decodificado girado): no se gira de nuevo', async () => {
    // El JPEG guarda 4000×3000 con orientación 6; el navegador lo decodifica 3000×4000.
    imageSize = { width: 3000, height: 4000 }
    const result = await compressImage(
      jpegFile({ orientation: 6, width: 4000, height: 3000 }),
    )
    expect([result.width, result.height]).toEqual([960, 1280])
    // Matriz de identidad escalada: solo achica.
    expect(transforms[0]).toEqual([0.32, 0, 0, 0.32, 0, 0])
  })

  it('el navegador NO la aplicó (tamaño crudo): la aplica a mano', async () => {
    imageSize = { width: 4000, height: 3000 }
    const result = await compressImage(
      jpegFile({ orientation: 6, width: 4000, height: 3000 }),
    )
    expect([result.width, result.height]).toEqual([960, 1280])
    // Rotación de 90° con la escala de 0,32 (1280 / 4000).
    expect(transforms[0]).toEqual([0, 0.32, -0.32, 0, 960, 0])
  })

  it('sin orientación (1) no hace ninguna transformación', async () => {
    await compressImage(jpegFile({ orientation: 1 }))
    expect(transforms[0]?.slice(0, 4)).toEqual([0.32, 0, 0, 0.32])
  })
})

describe('compressImage: captured_at', () => {
  it('toma la fecha del EXIF antes de descartarlo', async () => {
    const result = await compressImage(
      jpegFile({ dateTimeOriginal: '2026:10:13 08:15:30' }),
    )
    expect(result.capturedAt?.toISOString()).toBe('2026-10-13T11:15:30.000Z')
  })

  it('sin EXIF usa la fecha de modificación del archivo', async () => {
    const result = await compressImage(jpegFile())
    expect(result.capturedAt?.toISOString()).toBe('2026-10-12T12:00:00.000Z')
  })

  it('sin EXIF ni fecha de archivo (Blob suelto) queda en null', async () => {
    const blob = new Blob([buildJpeg().slice().buffer], { type: 'image/jpeg' })
    const result = await compressImage(blob)
    expect(result.capturedAt).toBeNull()
  })

  it('el resultado no lleva metadatos: es un JPEG nuevo del canvas', async () => {
    const result = await compressImage(
      jpegFile({ dateTimeOriginal: '2026:10:13 08:15:30', orientation: 6 }),
    )
    // Lo que sube es el Blob del canvas, no el archivo original.
    expect(result.file).not.toBeInstanceOf(File)
  })
})

describe('compressImage: errores', () => {
  it('rechaza lo que no es una imagen', async () => {
    const file = new File(['hola'], 'nota.txt', { type: 'text/plain' })
    await expect(compressImage(file)).rejects.toMatchObject({
      code: 'unsupported_file',
    })
  })

  it('una imagen que no se puede decodificar da un error en español', async () => {
    imageFails = true
    const error = await compressImage(jpegFile()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MediaError)
    expect((error as MediaError).code).toBe('image_unreadable')
    expect((error as MediaError).message).toBe(
      'No pudimos leer esa foto. Probá con otra.',
    )
  })

  it('se puede cancelar con AbortSignal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      compressImage(jpegFile(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'canceled' })
  })
})
