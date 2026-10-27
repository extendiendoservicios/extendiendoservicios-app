/**
 * Compresión de la imagen de un artículo (IS-04, IS-32), en el navegador y
 * como en el módulo H pero a medida del catálogo: lado mayor de 1200 px, sin
 * agrandar las más chicas, y WebP (si el navegador no lo sabe generar, JPEG,
 * que el bucket `supply-images` también admite). Redibujar en un canvas
 * descarta los metadatos (EXIF, GPS incluido).
 */
import {
  canvasToBlob,
  createCanvas,
  fitWithin,
  getContext2d,
} from '@/lib/media/canvas'
import { MediaError } from '@/lib/media/errors'

/** Lado mayor de la imagen comprimida (IS-32). */
export const SUPPLY_IMAGE_MAX_SIDE_PX = 1200
/** Tope del archivo elegido, antes de comprimir. */
export const SUPPLY_IMAGE_MAX_SOURCE_BYTES = 15 * 1024 * 1024
/** Tope del bucket `supply-images` (2 MB); se deja un margen. */
export const SUPPLY_IMAGE_MAX_BYTES = 1_900_000
/** Escalones de calidad, de mayor a menor, hasta entrar en el tope. */
export const SUPPLY_IMAGE_QUALITY_STEPS = [0.82, 0.7, 0.55, 0.4] as const

export const SUPPLY_IMAGE_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

/** `null` si el archivo se puede usar; si no, el mensaje en español. */
export function validateSupplyImageFile(file: File): string | null {
  if (!(SUPPLY_IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return 'La imagen tiene que ser un archivo JPG, PNG o WEBP.'
  }
  if (file.size > SUPPLY_IMAGE_MAX_SOURCE_BYTES) {
    return 'La imagen pesa demasiado. Elegí una de hasta 15 MB.'
  }
  return null
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new MediaError('image_unreadable'))
    }
    image.src = url
  })
}

/**
 * Deja la imagen lista para subir: lado mayor de 1200 px, WebP (o JPEG) y
 * por debajo de 2 MB. Lanza `MediaError` con mensaje en español.
 */
export async function compressSupplyImage(file: Blob): Promise<Blob> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new MediaError('unsupported_file')
  }
  const image = await loadImage(file)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height) throw new MediaError('image_unreadable')

  const target = fitWithin(width, height, SUPPLY_IMAGE_MAX_SIDE_PX)
  const canvas = createCanvas(target.width, target.height)
  const context = getContext2d(canvas)
  context.fillStyle = '#ffffff' // los PNG con transparencia no quedan negros
  context.fillRect(0, 0, target.width, target.height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, target.width, target.height)

  for (const quality of SUPPLY_IMAGE_QUALITY_STEPS) {
    const webp = await canvasToBlob(canvas, 'image/webp', quality)
    // Un navegador sin WebP devuelve PNG: se pasa a JPEG.
    const blob =
      webp.type === 'image/webp'
        ? webp
        : await canvasToBlob(canvas, 'image/jpeg', quality)
    if (blob.size <= SUPPLY_IMAGE_MAX_BYTES) return blob
  }
  throw new MediaError(
    'compression_failed',
    'La imagen sigue pesando demasiado. Probá con otra más simple.',
  )
}
