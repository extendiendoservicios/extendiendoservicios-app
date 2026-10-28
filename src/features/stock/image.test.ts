import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaError } from '@/lib/media/errors'
import {
  compressSupplyImage,
  SUPPLY_IMAGE_MAX_BYTES,
  SUPPLY_IMAGE_MAX_SIDE_PX,
  validateSupplyImageFile,
} from './image'

/**
 * jsdom no decodifica ni dibuja imágenes: se simulan `Image` (con el tamaño
 * que decodificaría el navegador) y el canvas (`toBlob`, con un peso que
 * depende de la calidad pedida y del tipo que "soporta" el navegador).
 */

interface Drawn {
  width: number
  height: number
  type: string
  quality: number | undefined
}

let imageSize = { width: 4000, height: 3000 }
let imageFails = false
let supportsWebp = true
let bytesForQuality: (quality: number | undefined) => number
let blobs: Drawn[] = []

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

beforeEach(() => {
  imageSize = { width: 4000, height: 3000 }
  imageFails = false
  supportsWebp = true
  blobs = []
  bytesForQuality = () => 200 * 1024
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
    // Sin WebP, el navegador devuelve PNG.
    const real = type === 'image/webp' && !supportsWebp ? 'image/png' : type
    blobs.push({
      width: this.width,
      height: this.height,
      type: real ?? 'image/png',
      quality,
    })
    callback(
      new Blob([new Uint8Array(bytesForQuality(quality))], {
        type: real ?? 'image/png',
      }),
    )
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function pngFile(size = 1000) {
  return new File([new Uint8Array(size)], 'a.png', { type: 'image/png' })
}

describe('compressSupplyImage (IS-32)', () => {
  it('foto horizontal de 4000×3000: lado mayor de 1200 px y WebP', async () => {
    const result = await compressSupplyImage(pngFile())
    expect(result.type).toBe('image/webp')
    expect(blobs[0]).toMatchObject({
      width: SUPPLY_IMAGE_MAX_SIDE_PX,
      height: 900,
      type: 'image/webp',
    })
  })

  it('foto vertical de 3000×4000: 900×1200', async () => {
    imageSize = { width: 3000, height: 4000 }
    await compressSupplyImage(pngFile())
    expect(blobs[0]).toMatchObject({ width: 900, height: 1200 })
  })

  it('no agranda una imagen que ya es chica', async () => {
    imageSize = { width: 600, height: 400 }
    await compressSupplyImage(pngFile())
    expect(blobs[0]).toMatchObject({ width: 600, height: 400 })
  })

  it('baja la calidad por pasos si pesa más del tope del bucket', async () => {
    bytesForQuality = (quality) =>
      (quality ?? 1) > 0.7 ? SUPPLY_IMAGE_MAX_BYTES + 1 : 300 * 1024
    const result = await compressSupplyImage(pngFile())
    expect(result.size).toBe(300 * 1024)
    expect(blobs.map((drawn) => drawn.quality)).toEqual([0.82, 0.7])
  })

  it('si no entra ni con la calidad más baja, avisa en español', async () => {
    bytesForQuality = () => SUPPLY_IMAGE_MAX_BYTES + 1
    await expect(compressSupplyImage(pngFile())).rejects.toMatchObject({
      name: 'MediaError',
      message: expect.stringContaining('pesando demasiado') as string,
    })
  })

  it('un navegador sin WebP genera JPEG', async () => {
    supportsWebp = false
    const result = await compressSupplyImage(pngFile())
    expect(result.type).toBe('image/jpeg')
  })

  it('una imagen ilegible da un error de media en español', async () => {
    imageFails = true
    await expect(compressSupplyImage(pngFile())).rejects.toBeInstanceOf(
      MediaError,
    )
  })

  it('rechaza un archivo que no es una imagen', async () => {
    await expect(
      compressSupplyImage(
        new File(['x'], 'a.pdf', { type: 'application/pdf' }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported_file' })
  })
})

describe('validateSupplyImageFile', () => {
  it('acepta JPG, PNG y WEBP', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateSupplyImageFile(new File(['x'], 'a', { type }))).toBeNull()
    }
  })

  it('rechaza otros tipos y archivos de más de 15 MB', () => {
    expect(
      validateSupplyImageFile(new File(['x'], 'a.gif', { type: 'image/gif' })),
    ).toContain('JPG, PNG o WEBP')
    const big = new File([new Uint8Array(16 * 1024 * 1024)], 'a.png', {
      type: 'image/png',
    })
    expect(validateSupplyImageFile(big)).toContain('15 MB')
  })
})
