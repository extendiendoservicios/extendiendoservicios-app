import { describe, expect, it, vi } from 'vitest'
import {
  AVATAR_CROP_VIEWPORT_PX,
  avatarOffsetToCropRect,
  avatarStoragePath,
  clampAvatarOffset,
  computeAvatarDisplayScale,
  cropAndResizeToBlob,
  validateAvatarSourceFile,
} from './avatarImage'

/**
 * `avatarImage.ts` (EMP-011): geometría del recorte y validación del
 * archivo elegido, sin montar `AvatarUpload.tsx` ni un `<canvas>` real
 * (salvo en `cropAndResizeToBlob`, con un `getContext`/`toBlob` simulados).
 */

function makeFile(name: string, type: string, sizeBytes: number): File {
  // `File` real de jsdom, con un `Blob` del tamaño pedido (sin necesidad de
  // que el contenido sea una imagen válida: acá solo se prueba validación).
  const content = new Uint8Array(sizeBytes)
  return new File([content], name, { type })
}

describe('validateAvatarSourceFile', () => {
  it('acepta JPG, PNG y WEBP dentro del límite de tamaño', () => {
    expect(
      validateAvatarSourceFile(makeFile('foto.jpg', 'image/jpeg', 1000)),
    ).toBeNull()
    expect(
      validateAvatarSourceFile(makeFile('foto.png', 'image/png', 1000)),
    ).toBeNull()
    expect(
      validateAvatarSourceFile(makeFile('foto.webp', 'image/webp', 1000)),
    ).toBeNull()
  })

  it('rechaza un tipo de archivo que no es imagen', () => {
    const error = validateAvatarSourceFile(
      makeFile('documento.pdf', 'application/pdf', 1000),
    )
    expect(error).toBe('La foto tiene que ser un archivo JPG, PNG o WEBP.')
  })

  it('rechaza un archivo más pesado que el límite', () => {
    const error = validateAvatarSourceFile(
      makeFile('foto.jpg', 'image/jpeg', 16 * 1024 * 1024),
    )
    expect(error).toBe('La foto pesa demasiado. Elegí una de hasta 15 MB.')
  })
})

describe('computeAvatarDisplayScale', () => {
  it('a zoom 1, el lado corto de la imagen ocupa exactamente el recuadro', () => {
    // Imagen apaisada de 2000×1000: el lado corto es 1000.
    const scale = computeAvatarDisplayScale(2000, 1000, 260, 1)
    expect(scale).toBeCloseTo(260 / 1000)
  })

  it('a más zoom, la escala crece en la misma proporción', () => {
    const scaleAt1 = computeAvatarDisplayScale(1000, 1000, 260, 1)
    const scaleAt2 = computeAvatarDisplayScale(1000, 1000, 260, 2)
    expect(scaleAt2).toBeCloseTo(scaleAt1 * 2)
  })
})

describe('clampAvatarOffset', () => {
  it('no deja que la imagen se separe del borde superior/izquierdo del recuadro', () => {
    expect(clampAvatarOffset(50, 400, 260)).toBe(0)
  })

  it('no deja un hueco en el borde inferior/derecho', () => {
    // Imagen de 300 px mostrada en un recuadro de 260: el desplazamiento
    // mínimo (más negativo) es 260 - 300 = -40.
    expect(clampAvatarOffset(-100, 300, 260)).toBe(-40)
  })

  it('con un valor ya dentro de rango, lo deja igual', () => {
    expect(clampAvatarOffset(-20, 300, 260)).toBe(-20)
  })
})

describe('avatarOffsetToCropRect', () => {
  it('convierte el desplazamiento y la escala de pantalla al recorte en píxeles originales', () => {
    const crop = avatarOffsetToCropRect({
      offsetX: -50,
      offsetY: -20,
      displayScale: 0.5,
      viewportPx: AVATAR_CROP_VIEWPORT_PX,
    })
    expect(crop).toEqual({
      x: 100,
      y: 40,
      size: AVATAR_CROP_VIEWPORT_PX / 0.5,
    })
  })
})

describe('avatarStoragePath', () => {
  it('arranca con el profileId y termina en .jpg', () => {
    const path = avatarStoragePath('11111111-1111-1111-1111-111111111111')
    expect(path.startsWith('11111111-1111-1111-1111-111111111111/')).toBe(true)
    expect(path.endsWith('.jpg')).toBe(true)
  })

  it('genera una ruta distinta en cada llamada (nombre no adivinable, sin choques de caché)', () => {
    const first = avatarStoragePath('perfil-1')
    const second = avatarStoragePath('perfil-1')
    expect(first).not.toBe(second)
  })
})

describe('cropAndResizeToBlob', () => {
  it('dibuja el recorte pedido y exporta un Blob JPEG', async () => {
    const drawImage = vi.fn()
    const fakeBlob = new Blob(['contenido'], { type: 'image/jpeg' })
    const fakeContext = { drawImage } as unknown as CanvasRenderingContext2D
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(fakeContext)
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(fakeBlob))

    const fakeImage = {} as CanvasImageSource
    const blob = await cropAndResizeToBlob(
      fakeImage,
      { x: 10, y: 20, size: 300 },
      512,
    )

    expect(drawImage).toHaveBeenCalledWith(
      fakeImage,
      10,
      20,
      300,
      300,
      0,
      0,
      512,
      512,
    )
    expect(toBlobSpy).toHaveBeenCalledWith(
      expect.any(Function),
      'image/jpeg',
      expect.any(Number),
    )
    expect(blob).toBe(fakeBlob)

    getContextSpy.mockRestore()
    toBlobSpy.mockRestore()
  })

  it('si el navegador no puede exportar el Blob, rechaza con un mensaje en español', async () => {
    const fakeContext = {
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(fakeContext)
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(null))

    await expect(
      cropAndResizeToBlob({} as CanvasImageSource, { x: 0, y: 0, size: 100 }),
    ).rejects.toThrow(
      'No pudimos preparar la imagen para subir. Probá de nuevo.',
    )

    getContextSpy.mockRestore()
    toBlobSpy.mockRestore()
  })
})
