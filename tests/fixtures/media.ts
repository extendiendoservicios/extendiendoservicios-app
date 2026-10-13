// tests/fixtures/media.ts — TEST-030 (P21.6, módulo H · evidencia fotográfica)
//
// Piezas compartidas por las pruebas de evidencia (permisos por API directa y e2e):
//  - archivos de prueba: un JPEG con la estructura mínima (sirve para subir por API, el bucket
//    solo mira el tipo declarado), un JPEG que el navegador SÍ puede decodificar (para elegirlo
//    en la galería de la app) y un WebM corto grabado en la propia página;
//  - la subida completa por API con la sesión de una cuenta (`begin_shift_media` -> Storage ->
//    `confirm_shift_media`), igual que lo hace el celular;
//  - lectura de lo que quedó (con la clave de servicio) para verificar residuos.
//
// La limpieza de la evidencia de un cliente la hace `deleteClientDeep` (`scenario.ts`).

import type { Page } from '@playwright/test'
import type { AdminDb } from './accounts.ts'

/** Estructura mínima de un JPEG (cabecera JFIF y fin de imagen): alcanza para subir por API. */
export const JPEG_ESTRUCTURA = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
])

export type BeginResult = {
  media: { id: string; storage_path: string; thumb_path: string }
  bucket: string
  storage_path: string
  thumb_path: string
}

export interface BeginOptions {
  kind?: 'photo' | 'video'
  mimeType?: string
  sizeBytes?: number
  thumbSizeBytes?: number
  durationSeconds?: number | null
  /** Contenido de la foto y de la miniatura que se suben (por defecto, la estructura mínima). */
  bytes?: Uint8Array
}

/** `begin_shift_media` con los valores por defecto de una foto de prueba. */
export async function empezarEvidencia(
  client: AdminDb,
  shiftId: string,
  options: BeginOptions = {},
) {
  const kind = options.kind ?? 'photo'
  return client.rpc('begin_shift_media', {
    p_shift_id: shiftId,
    p_kind: kind,
    p_mime_type:
      options.mimeType ?? (kind === 'photo' ? 'image/jpeg' : 'video/mp4'),
    p_size_bytes: options.sizeBytes ?? 1000,
    p_thumb_size_bytes: options.thumbSizeBytes ?? 100,
    ...(options.durationSeconds !== undefined
      ? { p_duration_s: options.durationSeconds ?? undefined }
      : kind === 'video'
        ? { p_duration_s: 10 }
        : {}),
    p_width: 640,
    p_height: 480,
  })
}

/**
 * Sube una foto (o video) completa con la sesión del cliente: begin, archivo y miniatura al
 * bucket `evidence` (sin `upsert`) y confirm. Lanza si algún paso falla.
 */
export async function subirEvidencia(
  client: AdminDb,
  shiftId: string,
  options: BeginOptions = {},
): Promise<{ id: string; storagePath: string; thumbPath: string }> {
  const kind = options.kind ?? 'photo'
  const begin = await empezarEvidencia(client, shiftId, options)
  if (begin.error) {
    throw new Error(
      `begin_shift_media: ${begin.error.hint ?? ''} ${begin.error.message}`,
    )
  }
  const data = begin.data as unknown as BeginResult
  const mime =
    kind === 'photo' ? 'image/jpeg' : (options.mimeType ?? 'video/mp4')
  const archivo = await client.storage
    .from('evidence')
    .upload(data.storage_path, options.bytes ?? JPEG_ESTRUCTURA, {
      contentType: mime,
    })
  if (archivo.error) throw new Error(`subir archivo: ${archivo.error.message}`)
  const mini = await client.storage
    .from('evidence')
    .upload(data.thumb_path, options.bytes ?? JPEG_ESTRUCTURA, {
      contentType: 'image/jpeg',
    })
  if (mini.error) throw new Error(`subir miniatura: ${mini.error.message}`)
  const confirm = await client.rpc('confirm_shift_media', {
    p_media_id: data.media.id,
  })
  if (confirm.error) {
    throw new Error(
      `confirm_shift_media: ${confirm.error.hint ?? ''} ${confirm.error.message}`,
    )
  }
  return {
    id: data.media.id,
    storagePath: data.storage_path,
    thumbPath: data.thumb_path,
  }
}

/**
 * JPEG que el navegador decodifica de verdad (lo dibuja y exporta la propia página con un
 * canvas). Es lo que se elige en la galería de la app: `compressImage` lo lee, lo redimensiona
 * y lo recodifica. El color y la cantidad de píxeles se pueden variar para tener archivos
 * distintos.
 */
export async function jpegDecodificable(
  page: Page,
  options: { ancho?: number; alto?: number; color?: string } = {},
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ ancho, alto, color }) => {
      const canvas = document.createElement('canvas')
      canvas.width = ancho
      canvas.height = alto
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = color
      ctx.fillRect(0, 0, ancho, alto)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(ancho / 4, alto / 4, ancho / 2, alto / 2)
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('sin blob'))),
          'image/jpeg',
          0.8,
        ),
      )
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binario = ''
      for (const byte of bytes) binario += String.fromCharCode(byte)
      return btoa(binario)
    },
    {
      ancho: options.ancho ?? 1600,
      alto: options.alto ?? 1200,
      color: options.color ?? '#0d9488',
    },
  )
  return Buffer.from(base64, 'base64')
}

/**
 * Video WebM de un segundo grabado en la página con `MediaRecorder` sobre un canvas. Es un video
 * real que el navegador puede abrir (tiene ancho, alto y cuadros). La duración que declara el
 * archivo no es confiable (los WebM grabados al vuelo no la traen), así que quien necesite "un
 * video de 40 segundos" la simula aparte (ver `simularDuracionDeVideo`).
 */
export async function webmCorto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')!
    const stream = canvas.captureStream(15)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const partes: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) partes.push(e.data)
    }
    const terminado = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.start()
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const dibujar = () => {
        const t = performance.now() - t0
        ctx.fillStyle = `hsl(${(t / 5) % 360} 70% 50%)`
        ctx.fillRect(0, 0, 320, 240)
        if (t < 1000) requestAnimationFrame(dibujar)
        else resolve()
      }
      dibujar()
    })
    recorder.stop()
    await terminado
    const blob = new Blob(partes, { type: 'video/webm' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binario = ''
    for (const byte of bytes) binario += String.fromCharCode(byte)
    return btoa(binario)
  })
  return Buffer.from(base64, 'base64')
}

/**
 * Hace que los elementos `<video>` de la página informen la duración dada (en segundos). Sirve
 * para "elegir un video de 40 segundos" sin grabar 40 segundos de verdad: el archivo es real, lo
 * único simulado es la duración que lee la app. Llamar ANTES de elegir el archivo.
 */
export async function simularDuracionDeVideo(
  page: Page,
  segundos: number,
): Promise<void> {
  await page.evaluate((valor) => {
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get: () => valor,
    })
  }, segundos)
}

/** Objetos que hay en el bucket `evidence` (todas las carpetas). */
export async function objetosDeEvidencia(db: AdminDb): Promise<string[]> {
  const carpetas = await db.storage.from('evidence').list('', { limit: 1000 })
  const rutas: string[] = []
  for (const carpeta of carpetas.data ?? []) {
    const dentro = await db.storage
      .from('evidence')
      .list(carpeta.name, { limit: 1000 })
    for (const obj of dentro.data ?? [])
      rutas.push(`${carpeta.name}/${obj.name}`)
  }
  return rutas
}
