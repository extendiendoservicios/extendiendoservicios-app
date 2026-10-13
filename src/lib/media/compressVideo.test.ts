import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compressVideo } from './compressVideo'
import { MediaError } from './errors'
import { transcodeWithWebCodecs } from './compressVideoWebCodecs'
import { canRecordRealtime, transcodeRealtime } from './compressVideoRealtime'
import {
  captureVideoThumbnail,
  makePlaceholderThumbnail,
  readVideoInfo,
} from './videoFrames'

vi.mock('./compressVideoWebCodecs', () => ({
  transcodeWithWebCodecs: vi.fn(),
  hasWebCodecs: vi.fn(),
}))
vi.mock('./compressVideoRealtime', () => ({
  transcodeRealtime: vi.fn(),
  canRecordRealtime: vi.fn(),
}))
vi.mock('./videoFrames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./videoFrames')>()),
  readVideoInfo: vi.fn(),
  captureVideoThumbnail: vi.fn(),
  makePlaceholderThumbnail: vi.fn(),
}))

const webcodecs = vi.mocked(transcodeWithWebCodecs)
const realtime = vi.mocked(transcodeRealtime)
const canRealtime = vi.mocked(canRecordRealtime)
const info = vi.mocked(readVideoInfo)
const thumb = vi.mocked(captureVideoThumbnail)
const placeholder = vi.mocked(makePlaceholderThumbnail)

/** Un Blob de MP4 que dice pesar `bytes` (sin reservar la memoria de verdad). */
const mp4 = (bytes = 3 * 1024 * 1024) =>
  Object.defineProperty(new Blob([], { type: 'video/mp4' }), 'size', {
    value: bytes,
  })

const original = new File(['x'], 'galeria.mp4', {
  type: 'video/mp4',
  lastModified: Date.UTC(2026, 9, 13, 12, 0, 0),
})

beforeEach(() => {
  vi.resetAllMocks()
  info.mockResolvedValue({ durationSeconds: 12, width: 1920, height: 1080 })
  thumb.mockResolvedValue(new Blob(['t'], { type: 'image/jpeg' }))
  placeholder.mockResolvedValue(new Blob(['p'], { type: 'image/jpeg' }))
  webcodecs.mockResolvedValue({ file: mp4(), hasAudio: true })
  canRealtime.mockReturnValue(true)
})

describe('compressVideo: duración', () => {
  it('rechaza más de 30 s antes de procesar nada', async () => {
    info.mockResolvedValue({ durationSeconds: 45, width: 1920, height: 1080 })
    const error = await compressVideo(original).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MediaError)
    expect((error as MediaError).code).toBe('video_too_long')
    expect((error as MediaError).message).toBe(
      'El video dura más de 30 segundos. Elegí uno más corto.',
    )
    expect(webcodecs).not.toHaveBeenCalled()
    expect(realtime).not.toHaveBeenCalled()
  })

  it('acepta 30 s justos y una décima de más (tolerancia de 0,5 s)', async () => {
    info.mockResolvedValue({ durationSeconds: 30.3, width: 1280, height: 720 })
    await expect(compressVideo(original)).resolves.toMatchObject({
      kind: 'video',
    })
  })

  it('rechaza 30,6 s', async () => {
    info.mockResolvedValue({ durationSeconds: 30.6, width: 1280, height: 720 })
    await expect(compressVideo(original)).rejects.toMatchObject({
      code: 'video_too_long',
    })
  })

  it('rechaza lo que no es un video', async () => {
    const foto = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    await expect(compressVideo(foto)).rejects.toMatchObject({
      code: 'unsupported_file',
    })
  })
})

describe('compressVideo: camino principal (WebCodecs)', () => {
  it('apaisado 1080p sale a 854×480 en MP4, con miniatura y fecha del archivo', async () => {
    const result = await compressVideo(original)
    expect(webcodecs).toHaveBeenCalledWith(
      original,
      expect.objectContaining({ width: 854, height: 480 }),
    )
    expect(realtime).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      kind: 'video',
      mimeType: 'video/mp4',
      extension: 'mp4',
      width: 854,
      height: 480,
      durationSeconds: 12,
      mode: 'webcodecs',
      hasAudio: true,
    })
    expect(result.capturedAt?.toISOString()).toBe('2026-10-13T12:00:00.000Z')
    expect(result.totalBytes).toBe(result.bytes + result.thumbnailBytes)
  })

  it('vertical 1080×1920 sale a 480×854 (el lado menor es el que queda en 480)', async () => {
    info.mockResolvedValue({ durationSeconds: 10, width: 1080, height: 1920 })
    const result = await compressVideo(original)
    expect([result.width, result.height]).toEqual([480, 854])
  })

  it('un video chico no se agranda', async () => {
    info.mockResolvedValue({ durationSeconds: 10, width: 640, height: 360 })
    const result = await compressVideo(original)
    expect([result.width, result.height]).toEqual([640, 360])
  })

  it('informa el progreso con el modo', async () => {
    webcodecs.mockImplementation((_blob, options) => {
      options.onProgress?.(0.5)
      return Promise.resolve({ file: mp4(), hasAudio: true })
    })
    const onProgress = vi.fn()
    await compressVideo(original, { onProgress })
    expect(onProgress).toHaveBeenCalledWith({
      fraction: 0.5,
      mode: 'webcodecs',
    })
  })

  it('si no se puede sacar la miniatura, usa una neutra y no falla', async () => {
    thumb.mockRejectedValue(new MediaError('video_unreadable'))
    const result = await compressVideo(original)
    expect(placeholder).toHaveBeenCalled()
    expect(result.thumbnailBytes).toBe(1)
  })
})

describe('compressVideo: tamaño del resultado', () => {
  it('rechaza si pasa de 20 MB ya comprimido', async () => {
    webcodecs.mockResolvedValue({
      file: mp4(21 * 1024 * 1024),
      hasAudio: true,
    })
    const error = await compressVideo(original).catch((e: unknown) => e)
    expect((error as MediaError).code).toBe('video_too_large')
    expect((error as MediaError).message).toContain('20 MB')
  })

  it('20 MB justos todavía entran', async () => {
    webcodecs.mockResolvedValue({
      file: mp4(20 * 1024 * 1024),
      hasAudio: true,
    })
    await expect(compressVideo(original)).resolves.toMatchObject({
      bytes: 20 * 1024 * 1024,
    })
  })
})

describe('compressVideo: fallback con canvas y MediaRecorder', () => {
  const realtimeResult = {
    file: mp4(2 * 1024 * 1024),
    format: {
      recorderType: 'video/webm;codecs=vp8,opus',
      mimeType: 'video/webm' as const,
      extension: 'webm' as const,
    },
    hasAudio: false,
  }

  it('sin WebCodecs (devuelve null) usa el fallback y lo marca', async () => {
    webcodecs.mockResolvedValue(null)
    realtime.mockResolvedValue(realtimeResult)
    const onProgress = vi.fn()
    const result = await compressVideo(original, { onProgress })
    expect(realtime).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      mode: 'realtime',
      mimeType: 'video/webm',
      extension: 'webm',
      hasAudio: false,
    })
    expect(onProgress).toHaveBeenCalledWith({ fraction: 0, mode: 'realtime' })
  })

  it('si WebCodecs falla a mitad de camino, cae al fallback en vez de perder el video', async () => {
    webcodecs.mockRejectedValue(new Error('EncodingError'))
    realtime.mockResolvedValue(realtimeResult)
    const result = await compressVideo(original)
    expect(result.mode).toBe('realtime')
  })

  it('si no hay ningún camino posible, avisa en español', async () => {
    webcodecs.mockResolvedValue(null)
    canRealtime.mockReturnValue(false)
    await expect(compressVideo(original)).rejects.toMatchObject({
      code: 'compression_failed',
    })
  })

  it('el tope de 20 MB también vale para el fallback', async () => {
    webcodecs.mockResolvedValue(null)
    realtime.mockResolvedValue({
      ...realtimeResult,
      file: mp4(25 * 1024 * 1024),
    })
    await expect(compressVideo(original)).rejects.toMatchObject({
      code: 'video_too_large',
    })
  })
})

describe('compressVideo: cancelación', () => {
  it('cancelar durante WebCodecs corta todo y no cae al fallback', async () => {
    webcodecs.mockRejectedValue(new MediaError('canceled'))
    await expect(compressVideo(original)).rejects.toMatchObject({
      code: 'canceled',
    })
    expect(realtime).not.toHaveBeenCalled()
  })

  it('una señal ya abortada no procesa nada', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      compressVideo(original, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'canceled' })
    expect(info).not.toHaveBeenCalled()
  })

  it('si se aborta y el motor tira otro error, igual se toma como cancelación', async () => {
    const controller = new AbortController()
    webcodecs.mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('InvalidStateError'))
    })
    await expect(
      compressVideo(original, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'canceled' })
    expect(realtime).not.toHaveBeenCalled()
  })
})
