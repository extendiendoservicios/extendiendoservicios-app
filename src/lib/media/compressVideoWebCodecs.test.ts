import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transcodeWithWebCodecs } from './compressVideoWebCodecs'

/**
 * Mediabunny se reemplaza por un doble: acá se prueba la lógica propia
 * (opciones pedidas, qué se hace si el navegador no puede, audio, cancelar).
 */

interface FakeTrack {
  isVideoTrack: () => boolean
  isAudioTrack: () => boolean
}
const videoTrack: FakeTrack = {
  isVideoTrack: () => true,
  isAudioTrack: () => false,
}
const audioTrack: FakeTrack = {
  isVideoTrack: () => false,
  isAudioTrack: () => true,
}

const state = {
  tracks: [videoTrack, audioTrack] as FakeTrack[],
  isValid: true,
  executeImpl: (_conversion: FakeConversion) => Promise.resolve(),
  initOptions: undefined as unknown,
  disposed: 0,
}

class FakeConversionCanceledError extends Error {}

class FakeConversion {
  isValid = state.isValid
  utilizedTracks = state.tracks
  onProgress?: (fraction: number) => void
  canceled = false
  static init(options: unknown) {
    state.initOptions = options
    return Promise.resolve(new FakeConversion())
  }
  execute() {
    return state.executeImpl(this)
  }
  cancel() {
    this.canceled = true
    return Promise.resolve()
  }
}

let bufferToReturn: ArrayBuffer | null = new Uint8Array(1024).buffer

vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  Mp4OutputFormat: class {},
  BufferTarget: class {
    get buffer() {
      return bufferToReturn
    }
  },
  Input: class {
    dispose() {
      state.disposed++
    }
  },
  Output: class {},
  Conversion: FakeConversion,
  ConversionCanceledError: FakeConversionCanceledError,
}))

const source = new Blob(['video'], { type: 'video/mp4' })
const options = { width: 854, height: 480 }

beforeEach(() => {
  state.tracks = [videoTrack, audioTrack]
  state.isValid = true
  state.executeImpl = () => Promise.resolve()
  state.initOptions = undefined
  state.disposed = 0
  bufferToReturn = new Uint8Array(1024).buffer
  vi.stubGlobal('VideoEncoder', class {})
  vi.stubGlobal('VideoDecoder', class {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('transcodeWithWebCodecs', () => {
  it('sin VideoEncoder/VideoDecoder devuelve null (se usa el fallback)', async () => {
    vi.stubGlobal('VideoEncoder', undefined)
    await expect(transcodeWithWebCodecs(source, options)).resolves.toBeNull()
    expect(state.initOptions).toBeUndefined()
  })

  it('pide H.264 a 854×480, ~700 kbps y audio a 64 kbps', async () => {
    await transcodeWithWebCodecs(source, options)
    expect(state.initOptions).toMatchObject({
      video: {
        width: 854,
        height: 480,
        codec: 'avc',
        bitrate: 700_000,
        fit: 'fill',
      },
      audio: { bitrate: 64_000 },
    })
  })

  it('devuelve un MP4 con audio y libera el archivo de entrada', async () => {
    const result = await transcodeWithWebCodecs(source, options)
    expect(result?.file.type).toBe('video/mp4')
    expect(result?.file.size).toBe(1024)
    expect(result?.hasAudio).toBe(true)
    expect(state.disposed).toBe(1)
  })

  it('si el navegador no puede codificar el audio, el video sale mudo', async () => {
    state.tracks = [videoTrack]
    const result = await transcodeWithWebCodecs(source, options)
    expect(result?.hasAudio).toBe(false)
  })

  it('si no puede codificar el video (conversión inválida), devuelve null', async () => {
    state.isValid = false
    await expect(transcodeWithWebCodecs(source, options)).resolves.toBeNull()
    expect(state.disposed).toBe(1)
  })

  it('una conversión solo de audio no sirve: devuelve null', async () => {
    state.tracks = [audioTrack]
    await expect(transcodeWithWebCodecs(source, options)).resolves.toBeNull()
  })

  it('pasa el progreso', async () => {
    const onProgress = vi.fn()
    state.executeImpl = (conversion) => {
      conversion.onProgress?.(0.25)
      return Promise.resolve()
    }
    await transcodeWithWebCodecs(source, { ...options, onProgress })
    expect(onProgress).toHaveBeenCalledWith(0.25)
  })

  it('abortar cancela la conversión y lanza «canceled»', async () => {
    const controller = new AbortController()
    let seen: FakeConversion | null = null
    state.executeImpl = (conversion) => {
      seen = conversion
      controller.abort()
      return Promise.reject(new FakeConversionCanceledError('cancelado'))
    }
    await expect(
      transcodeWithWebCodecs(source, { ...options, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'canceled' })
    expect((seen as FakeConversion | null)?.canceled).toBe(true)
    expect(state.disposed).toBe(1)
  })

  it('otro error del motor se propaga (el llamador decide caer al fallback)', async () => {
    state.executeImpl = () => Promise.reject(new Error('EncodingError'))
    await expect(transcodeWithWebCodecs(source, options)).rejects.toThrow(
      'EncodingError',
    )
  })

  it('sin buffer de salida devuelve null', async () => {
    bufferToReturn = null
    await expect(transcodeWithWebCodecs(source, options)).resolves.toBeNull()
  })
})
