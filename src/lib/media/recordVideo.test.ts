import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isIosDevice, pickRecorderFormat } from './mimeTypes'
import { recordVideo } from './recordVideo'
import { videoOutputSize } from './videoFrames'

vi.mock('./canvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./canvas')>()),
  makeThumbnail: vi.fn(() =>
    Promise.resolve(new Blob(['thumb'], { type: 'image/jpeg' })),
  ),
}))
vi.mock('./videoFrames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./videoFrames')>()),
  makePlaceholderThumbnail: vi.fn(() =>
    Promise.resolve(new Blob(['gris'], { type: 'image/jpeg' })),
  ),
}))

describe('pickRecorderFormat', () => {
  const only =
    (...types: string[]) =>
    (type: string) =>
      types.includes(type)

  it('en iPhone elige MP4 aunque el navegador también grabe WebM', () => {
    const format = pickRecorderFormat(
      only('video/webm;codecs=vp8,opus', 'video/mp4;codecs=avc1,mp4a.40.2'),
      true,
    )
    expect(format).toMatchObject({ mimeType: 'video/mp4', extension: 'mp4' })
  })

  it('en Android elige WebM (VP8) aunque Chrome también grabe MP4', () => {
    const format = pickRecorderFormat(
      only('video/webm;codecs=vp8,opus', 'video/mp4'),
      false,
    )
    expect(format).toMatchObject({
      recorderType: 'video/webm;codecs=vp8,opus',
      mimeType: 'video/webm',
      extension: 'webm',
    })
  })

  it('cada uno toma lo que soporta: iPhone sin MP4 usa WebM y Android sin WebM usa MP4', () => {
    expect(pickRecorderFormat(only('video/webm'), true)?.extension).toBe('webm')
    expect(pickRecorderFormat(only('video/mp4'), false)?.extension).toBe('mp4')
  })

  it('si no soporta ninguno, devuelve null', () => {
    expect(pickRecorderFormat(() => false, false)).toBeNull()
  })

  it('el tipo base que se sube nunca lleva códecs', () => {
    const format = pickRecorderFormat(() => true, true)
    expect(format?.mimeType).toBe('video/mp4')
    expect(format?.mimeType).not.toContain('codecs')
  })
})

describe('isIosDevice', () => {
  it('reconoce iPhone, iPad y el iPad que se presenta como Macintosh', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 5)).toBe(
      true,
    )
    expect(isIosDevice('Mozilla/5.0 (iPad; CPU OS 17_0)', 5)).toBe(true)
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5)).toBe(true)
  })
  it('no confunde Android ni una Mac sin pantalla táctil', () => {
    expect(isIosDevice('Mozilla/5.0 (Linux; Android 13)', 5)).toBe(false)
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 0)).toBe(
      false,
    )
  })
})

describe('videoOutputSize', () => {
  it('lleva el lado menor a 480 con medidas pares', () => {
    expect(videoOutputSize(1920, 1080, 480)).toEqual({
      width: 854,
      height: 480,
    })
    expect(videoOutputSize(1080, 1920, 480)).toEqual({
      width: 480,
      height: 854,
    })
    expect(videoOutputSize(1440, 1080, 480)).toEqual({
      width: 640,
      height: 480,
    })
  })
  it('no agranda', () => {
    expect(videoOutputSize(320, 240, 480)).toEqual({ width: 320, height: 240 })
  })
})

// ---- recordVideo ---------------------------------------------------------

class FakeRecorder extends EventTarget {
  static instances: FakeRecorder[] = []
  static isTypeSupported = vi.fn((type: string) =>
    type.startsWith('video/webm'),
  )
  state: 'inactive' | 'recording' = 'inactive'
  options: MediaRecorderOptions
  start = vi.fn(() => {
    this.state = 'recording'
  })
  stop = vi.fn(() => {
    this.state = 'inactive'
    const data = new Blob([new Uint8Array(3_000_000)], { type: 'video/webm' })
    this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }))
    this.dispatchEvent(new Event('stop'))
  })
  stream: MediaStream
  constructor(stream: MediaStream, options: MediaRecorderOptions) {
    super()
    this.stream = stream
    this.options = options
    FakeRecorder.instances.push(this)
  }
}

function fakeStream() {
  const stop = vi.fn()
  const track = {
    stop,
    getSettings: () => ({ width: 854, height: 480 }),
  }
  return {
    stream: {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream,
    stop,
  }
}

describe('recordVideo', () => {
  let getUserMedia: ReturnType<typeof vi.fn>
  let streamInfo: ReturnType<typeof fakeStream>

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
        'performance',
      ],
    })
    FakeRecorder.instances = []
    streamInfo = fakeStream()
    getUserMedia = vi.fn(() => Promise.resolve(streamInfo.stream))
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() =>
      Promise.resolve(),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('abre la cámara trasera a 854×480 y graba a 700 kbps de video y 64 de audio', async () => {
    const session = await recordVideo()
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        video: expect.objectContaining({
          facingMode: { ideal: 'environment' },
          width: { ideal: 854 },
          height: { ideal: 480 },
        }),
      }),
    )
    const recorder = FakeRecorder.instances[0]
    expect(recorder?.options).toMatchObject({
      videoBitsPerSecond: 700_000,
      audioBitsPerSecond: 64_000,
    })
    expect(session.format.mimeType).toBe('video/webm')
    session.dispose()
  })

  it('corta solo a los 30 s y la cuenta regresiva baja hasta 0', async () => {
    const ticks: number[] = []
    const session = await recordVideo({ onTick: (left) => ticks.push(left) })
    session.start()
    expect(ticks[0]).toBe(30)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(ticks.at(-1)).toBe(20)
    expect(FakeRecorder.instances[0]?.stop).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(20_100)
    expect(FakeRecorder.instances[0]?.stop).toHaveBeenCalledTimes(1)
    expect(ticks.at(-1)).toBe(0)

    const media = await session.result
    expect(media).toMatchObject({
      kind: 'video',
      mimeType: 'video/webm',
      extension: 'webm',
      width: 854,
      height: 480,
      durationSeconds: 30,
      bytes: 3_000_000,
    })
    expect(media.totalBytes).toBe(media.bytes + media.thumbnailBytes)
    expect(media.capturedAt).toBeInstanceOf(Date)
    session.dispose()
    expect(streamInfo.stop).toHaveBeenCalled()
  })

  it('detener antes de los 30 s devuelve la duración real', async () => {
    const session = await recordVideo()
    session.start()
    await vi.advanceTimersByTimeAsync(7_000)
    session.stop()
    const media = await session.result
    expect(media.durationSeconds).toBe(7)
    session.dispose()
  })

  it('descartar mientras graba cancela y no entrega nada', async () => {
    const session = await recordVideo()
    session.start()
    await vi.advanceTimersByTimeAsync(2_000)
    const outcome = session.result.catch((e: unknown) => e)
    session.dispose()
    await expect(outcome).resolves.toMatchObject({ code: 'canceled' })
    expect(streamInfo.stop).toHaveBeenCalled()
  })

  it('el permiso denegado da un mensaje en español', async () => {
    getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    await expect(recordVideo()).rejects.toMatchObject({
      code: 'camera_denied',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      message: expect.stringContaining('permiso'),
    })
  })

  it('sin cámara da camera_unavailable', async () => {
    getUserMedia.mockRejectedValue(new DOMException('no', 'NotReadableError'))
    await expect(recordVideo()).rejects.toMatchObject({
      code: 'camera_unavailable',
    })
  })

  it('sin micrófono reintenta solo con video', async () => {
    getUserMedia
      .mockRejectedValueOnce(new DOMException('no', 'NotFoundError'))
      .mockResolvedValueOnce(streamInfo.stream)
    const session = await recordVideo()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[1]?.[0]).toMatchObject({ audio: false })
    session.dispose()
  })

  it('sin MediaRecorder avisa que hay que usar la galería', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    await expect(recordVideo()).rejects.toMatchObject({
      code: 'recording_unsupported',
    })
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('una grabación vacía es un error, no un archivo de 0 bytes', async () => {
    const session = await recordVideo()
    session.start()
    const recorder = FakeRecorder.instances[0]
    recorder?.stop.mockImplementation(() => {
      recorder.state = 'inactive'
      recorder.dispatchEvent(new Event('stop'))
    })
    session.stop()
    await expect(session.result).rejects.toMatchObject({
      code: 'recording_failed',
    })
    session.dispose()
  })
})
