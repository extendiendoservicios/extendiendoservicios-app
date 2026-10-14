/**
 * Lectura de datos y cuadros de un video con un <video> en memoria
 * (duración, tamaño y miniatura). Usado por `compressVideo` y `recordVideo`.
 */

import {
  canvasToBlob,
  createCanvas,
  getContext2d,
  makeThumbnail,
} from './canvas'
import { MediaError } from './errors'
import { THUMB_MAX_SIDE_PX, THUMB_QUALITY } from './constants'

export interface VideoInfo {
  durationSeconds: number
  /** Tamaño tal como se ve (con la rotación del archivo ya aplicada). */
  width: number
  height: number
}

const LOAD_TIMEOUT_MS = 15_000

function openVideo(blob: Blob): {
  video: HTMLVideoElement
  dispose: () => void
} {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  return {
    video,
    dispose: () => {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    },
  }
}

function waitFor(
  target: HTMLVideoElement,
  event: 'loadedmetadata' | 'seeked',
  onError: () => MediaError,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(onError())
    }, LOAD_TIMEOUT_MS)
    const onOk = () => {
      cleanup()
      resolve()
    }
    const onFail = () => {
      cleanup()
      reject(onError())
    }
    const cleanup = () => {
      clearTimeout(timer)
      target.removeEventListener(event, onOk)
      target.removeEventListener('error', onFail)
    }
    target.addEventListener(event, onOk)
    target.addEventListener('error', onFail)
  })
}

/** Duración y tamaño de un video, leyendo solo los metadatos. */
export async function readVideoInfo(blob: Blob): Promise<VideoInfo> {
  const { video, dispose } = openVideo(blob)
  try {
    await waitFor(
      video,
      'loadedmetadata',
      () => new MediaError('video_unreadable'),
    )
    const durationSeconds = video.duration
    if (!Number.isFinite(durationSeconds) || !video.videoWidth) {
      throw new MediaError('video_unreadable')
    }
    return {
      durationSeconds,
      width: video.videoWidth,
      height: video.videoHeight,
    }
  } finally {
    dispose()
  }
}

/** Miniatura de un cuadro del video (H-16). */
export async function captureVideoThumbnail(
  blob: Blob,
  atSeconds: number,
): Promise<Blob> {
  const { video, dispose } = openVideo(blob)
  try {
    await waitFor(
      video,
      'loadedmetadata',
      () => new MediaError('video_unreadable'),
    )
    const seeked = waitFor(
      video,
      'seeked',
      () => new MediaError('video_unreadable'),
    )
    video.currentTime = Math.max(0, atSeconds)
    await seeked
    return await makeThumbnail(video, video.videoWidth, video.videoHeight)
  } finally {
    dispose()
  }
}

/** Miniatura gris para cuando no se pudo sacar un cuadro: la subida no se frena por eso. */
export async function makePlaceholderThumbnail(
  width: number,
  height: number,
): Promise<Blob> {
  const scale = Math.min(1, THUMB_MAX_SIDE_PX / Math.max(width, height, 1))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = createCanvas(w, h)
  const context = getContext2d(canvas)
  context.fillStyle = '#2b2f3b'
  context.fillRect(0, 0, w, h)
  return canvasToBlob(canvas, 'image/jpeg', THUMB_QUALITY)
}

/** Dimensiones de salida de 480p: lado MENOR a 480 px, pares, sin agrandar. */
export function videoOutputSize(
  width: number,
  height: number,
  shortSide: number,
): { width: number; height: number } {
  const scale = Math.min(1, shortSide / Math.min(width, height))
  const even = (value: number) =>
    Math.max(2, Math.round((value * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}
