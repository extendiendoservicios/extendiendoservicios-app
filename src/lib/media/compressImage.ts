/**
 * `compressImage` (módulo H, §3 y H-05/H-16): deja la foto lista para subir.
 *
 * - Aplica la orientación EXIF (sin duplicarla si el navegador ya lo hizo).
 * - Lado mayor de 1280 px, sin agrandar las más chicas.
 * - JPEG con calidad 0,72; si pasa de 300 KB baja la calidad por pasos.
 * - Sin metadatos: redibujar en un canvas descarta el EXIF, GPS incluido.
 * - Miniatura de 320 px.
 * - `capturedAt`: se lee del archivo ANTES de descartar los metadatos.
 */

import {
  PHOTO_MAX_SIDE_PX,
  PHOTO_QUALITY_STEPS,
  PHOTO_TARGET_MAX_BYTES,
} from './constants'
import {
  canvasToBlob,
  createCanvas,
  fitWithin,
  getContext2d,
  makeThumbnail,
} from './canvas'
import { MediaError } from './errors'
import { orientationTransform, readJpegMeta } from './exif'
import type { ProcessedMedia } from './types'

/** Con 256 KB alcanza para leer el EXIF y el tamaño crudo de un JPEG de celular. */
const META_BYTES = 256 * 1024

export interface CompressImageOptions {
  signal?: AbortSignal
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new MediaError('canceled')
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

export async function compressImage(
  file: Blob,
  options: CompressImageOptions = {},
): Promise<ProcessedMedia> {
  const { signal } = options
  if (file.type && !file.type.startsWith('image/')) {
    throw new MediaError('unsupported_file')
  }
  throwIfAborted(signal)

  // 1. Metadatos, antes de que se pierdan.
  const meta = readJpegMeta(await file.slice(0, META_BYTES).arrayBuffer())
  const lastModified = file instanceof File ? file.lastModified : 0
  const capturedAt =
    meta.capturedAt ?? (lastModified > 0 ? new Date(lastModified) : null)

  // 2. Decodificar.
  const image = await loadImage(file)
  throwIfAborted(signal)
  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (!naturalWidth || !naturalHeight) throw new MediaError('image_unreadable')

  // 3. Orientación. Los navegadores que soporta la app (Chrome 111+ y
  // Safari 16.4+) ya la aplican al decodificar un <img>. Si el JPEG dice
  // «girada» (5 a 8) pero el tamaño decodificado es el crudo, este
  // navegador no lo hizo y se aplica a mano. Con orientación 1 a 4 no hay
  // forma de distinguirlo por el tamaño: se asume lo mismo que en el caso
  // anterior (por defecto, ya aplicada).
  const swapsAxes = meta.orientation >= 5
  const browserApplied = !(
    swapsAxes &&
    meta.width !== null &&
    meta.height !== null &&
    meta.width !== meta.height &&
    naturalWidth === meta.width &&
    naturalHeight === meta.height
  )
  const transform = browserApplied
    ? orientationTransform(1, naturalWidth, naturalHeight)
    : orientationTransform(meta.orientation, naturalWidth, naturalHeight)

  // 4. Dibujar a 1280 px.
  const target = fitWithin(transform.width, transform.height, PHOTO_MAX_SIDE_PX)
  const scale = target.width / transform.width
  const canvas = createCanvas(target.width, target.height)
  const context = getContext2d(canvas)
  context.fillStyle = '#ffffff' // los PNG con transparencia no quedan negros
  context.fillRect(0, 0, target.width, target.height)
  const [a, b, c, d, e, f] = transform.matrix
  context.setTransform(
    a * scale,
    b * scale,
    c * scale,
    d * scale,
    e * scale,
    f * scale,
  )
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0)
  context.setTransform(1, 0, 0, 1, 0, 0)

  // 5. JPEG, bajando la calidad por pasos mientras pase de 300 KB.
  let blob: Blob | null = null
  for (const quality of PHOTO_QUALITY_STEPS) {
    throwIfAborted(signal)
    blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    if (blob.size <= PHOTO_TARGET_MAX_BYTES) break
  }
  if (!blob) throw new MediaError('compression_failed')

  // 6. Miniatura.
  const thumbnail = await makeThumbnail(canvas, target.width, target.height)

  return {
    kind: 'photo',
    file: blob,
    mimeType: 'image/jpeg',
    extension: 'jpg',
    thumbnail,
    width: target.width,
    height: target.height,
    bytes: blob.size,
    thumbnailBytes: thumbnail.size,
    totalBytes: blob.size + thumbnail.size,
    durationSeconds: null,
    capturedAt,
  }
}
