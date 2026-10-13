/**
 * Utilidades de canvas compartidas por `compressImage`, `recordVideo` y
 * `compressVideo`. Todo el dibujo pasa por acá para tener un solo punto
 * que mockear en los tests (jsdom no dibuja).
 */

import { MediaError } from './errors'
import { THUMB_MAX_SIDE_PX, THUMB_QUALITY } from './constants'

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function getContext2d(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new MediaError(
      'compression_failed',
      'Este navegador no puede procesar imágenes. Probá con otro.',
    )
  }
  return context
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new MediaError('compression_failed'))
      },
      type,
      quality,
    )
  })
}

/** Achica `width` × `height` para que el lado mayor no pase de `max`, sin agrandar. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Miniatura JPEG de ~320 px (H-16) a partir de cualquier fuente dibujable. */
export async function makeThumbnail(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): Promise<Blob> {
  const size = fitWithin(sourceWidth, sourceHeight, THUMB_MAX_SIDE_PX)
  const canvas = createCanvas(size.width, size.height)
  const context = getContext2d(canvas)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size.width, size.height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, size.width, size.height)
  return canvasToBlob(canvas, 'image/jpeg', THUMB_QUALITY)
}
