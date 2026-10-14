/**
 * Elección del formato de `MediaRecorder` (grabación dentro de la app y
 * fallback de `compressVideo`). iPhone solo graba MP4 (Safari 16.4 a 18.3);
 * Android con Chrome graba WebM. Cada uno toma lo que su navegador soporta.
 */

import type { MediaMimeType } from './types'

export interface RecorderFormat {
  /** Valor para `new MediaRecorder(stream, { mimeType })`, con códecs. */
  recorderType: string
  /** Tipo base, el que se sube a Storage. */
  mimeType: Extract<MediaMimeType, 'video/mp4' | 'video/webm'>
  extension: 'mp4' | 'webm'
}

const MP4: RecorderFormat[] = [
  {
    recorderType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    mimeType: 'video/mp4',
    extension: 'mp4',
  },
  {
    recorderType: 'video/mp4;codecs=avc1,mp4a.40.2',
    mimeType: 'video/mp4',
    extension: 'mp4',
  },
  { recorderType: 'video/mp4', mimeType: 'video/mp4', extension: 'mp4' },
]

const WEBM: RecorderFormat[] = [
  // VP8 primero: es el más liviano de codificar en un teléfono económico.
  {
    recorderType: 'video/webm;codecs=vp8,opus',
    mimeType: 'video/webm',
    extension: 'webm',
  },
  {
    recorderType: 'video/webm;codecs=vp9,opus',
    mimeType: 'video/webm',
    extension: 'webm',
  },
  { recorderType: 'video/webm', mimeType: 'video/webm', extension: 'webm' },
]

/** iPhone o iPad (los iPad nuevos se presentan como «Macintosh» con pantalla táctil). */
export function isIosDevice(
  userAgent: string = typeof navigator === 'undefined'
    ? ''
    : navigator.userAgent,
  maxTouchPoints: number = typeof navigator === 'undefined'
    ? 0
    : navigator.maxTouchPoints,
): boolean {
  return (
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  )
}

/**
 * El primer formato que el navegador puede grabar, o `null` si no puede
 * grabar ninguno. En iOS se prueba MP4 primero; en el resto, WebM primero.
 */
export function pickRecorderFormat(
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
  preferMp4: boolean = isIosDevice(),
): RecorderFormat | null {
  const ordered = preferMp4 ? [...MP4, ...WEBM] : [...WEBM, ...MP4]
  return ordered.find((format) => isSupported(format.recorderType)) ?? null
}
