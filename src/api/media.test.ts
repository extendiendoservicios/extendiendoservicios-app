import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessedMedia } from '@/lib/media/types'

/**
 * `src/api/media.ts` (módulo H, P21.3): mismo patrón sin red que el resto de
 * `src/api/` -- se mockea `@/lib/supabase` entero. Lo que importa acá es el
 * ORDEN del flujo de subida, la limpieza cuando algo falla, el abort y los
 * mensajes en español de cada código de error.
 */

const { fromMock, rpcMock, storageFromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  storageFromMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    storage: { from: storageFromMock },
  },
}))

const {
  createShiftMediaUpload,
  fetchMyShiftMedia,
  removeShiftMedia,
  signMediaUrl,
  mediaApiErrorMessage,
  MEDIA_HINT_MESSAGES,
  MEDIA_UPLOAD_FAILED_MESSAGE,
} = await import('./media')
const { ApiError } = await import('./errors')

const SHIFT_ID = 'shift-1'
const BEGIN_RESULT = {
  media: { id: 'media-1' },
  bucket: 'evidence',
  storage_path: 'shift-1/media-1.jpg',
  thumb_path: 'shift-1/media-1_thumb.jpg',
}

function processedPhoto(): ProcessedMedia {
  return {
    kind: 'photo',
    file: new Blob(['foto'], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    extension: 'jpg',
    thumbnail: new Blob(['mini'], { type: 'image/jpeg' }),
    width: 1280,
    height: 960,
    bytes: 150_000,
    thumbnailBytes: 20_000,
    totalBytes: 170_000,
    durationSeconds: null,
    capturedAt: new Date('2026-10-13T11:15:00Z'),
  }
}

function processedVideo(): ProcessedMedia {
  return {
    ...processedPhoto(),
    kind: 'video',
    mimeType: 'video/mp4',
    extension: 'mp4',
    durationSeconds: 12.4,
    capturedAt: null,
  }
}

interface StorageMock {
  upload: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  createSignedUrl: ReturnType<typeof vi.fn>
  createSignedUrls: ReturnType<typeof vi.fn>
}

function setupStorage(overrides: Partial<StorageMock> = {}): StorageMock {
  const storage: StorageMock = {
    upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://x/firmada' },
      error: null,
    }),
    createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
    ...overrides,
  }
  storageFromMock.mockReturnValue(storage)
  return storage
}

function makeChainable<T>(result: { data: T | null; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    then: (resolve: (value: unknown) => void, reject?: (r: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

/** Nombres de las RPC llamadas, en orden. */
function rpcNames(): string[] {
  return rpcMock.mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
  storageFromMock.mockReset()
})

describe('createShiftMediaUpload', () => {
  it('sigue el orden begin, archivo, miniatura y confirmación', async () => {
    const calls: string[] = []
    const storage = setupStorage({
      upload: vi.fn().mockImplementation((path: string) => {
        calls.push(`upload:${path}`)
        return Promise.resolve({ data: {}, error: null })
      }),
    })
    rpcMock.mockImplementation((name: string) => {
      calls.push(`rpc:${name}`)
      return Promise.resolve({
        data: name === 'begin_shift_media' ? BEGIN_RESULT : { id: 'media-1' },
        error: null,
      })
    })
    const progress: number[] = []

    const result = await createShiftMediaUpload(SHIFT_ID)(processedPhoto(), {
      signal: new AbortController().signal,
      onProgress: (fraction) => progress.push(fraction),
    })

    expect(result).toEqual({ id: 'media-1' })
    expect(calls).toEqual([
      'rpc:begin_shift_media',
      'upload:shift-1/media-1.jpg',
      'upload:shift-1/media-1_thumb.jpg',
      'rpc:confirm_shift_media',
    ])
    expect(progress.at(-1)).toBe(1)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
    // Sin `upsert` y con el tipo del archivo.
    expect(storage.upload).toHaveBeenNthCalledWith(
      1,
      'shift-1/media-1.jpg',
      expect.any(Blob),
      { contentType: 'image/jpeg', upsert: false },
    )
    expect(storage.upload).toHaveBeenNthCalledWith(
      2,
      'shift-1/media-1_thumb.jpg',
      expect.any(Blob),
      { contentType: 'image/jpeg', upsert: false },
    )
  })

  it('manda el tamaño del archivo y el de la miniatura por separado', async () => {
    setupStorage()
    rpcMock.mockResolvedValue({ data: BEGIN_RESULT, error: null })

    await createShiftMediaUpload(SHIFT_ID)(processedVideo(), {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'begin_shift_media', {
      p_shift_id: SHIFT_ID,
      p_kind: 'video',
      p_mime_type: 'video/mp4',
      p_size_bytes: 150_000,
      p_thumb_size_bytes: 20_000,
      p_width: 1280,
      p_height: 960,
      p_duration_s: 12.4,
      p_captured_at: undefined,
    })
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'confirm_shift_media', {
      p_media_id: 'media-1',
    })
  })

  it('manda la fecha de la foto cuando se conoce', async () => {
    setupStorage()
    rpcMock.mockResolvedValue({ data: BEGIN_RESULT, error: null })

    await createShiftMediaUpload(SHIFT_ID)(processedPhoto(), {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })

    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({
      p_captured_at: '2026-10-13T11:15:00.000Z',
      p_duration_s: undefined,
    })
  })

  it.each(Object.keys(MEDIA_HINT_MESSAGES))(
    'traduce el código %s del begin a su mensaje en español',
    async (hint) => {
      const storage = setupStorage()
      rpcMock.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'texto del servidor', hint },
      })

      const promise = createShiftMediaUpload(SHIFT_ID)(processedPhoto(), {
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })

      await expect(promise).rejects.toMatchObject({
        name: 'ApiError',
        hint,
        message: MEDIA_HINT_MESSAGES[hint],
      })
      // Si el begin falla no hay nada pendiente que limpiar ni archivos que subir.
      expect(storage.upload).not.toHaveBeenCalled()
      expect(rpcMock).toHaveBeenCalledTimes(1)
    },
  )

  it('si el servidor manda un código que no conocemos, deja su mensaje', async () => {
    setupStorage()
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Mensaje nuevo.', hint: 'OTRO_CODIGO' },
    })

    await expect(
      createShiftMediaUpload(SHIFT_ID)(processedPhoto(), {
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toMatchObject({ message: 'Mensaje nuevo.', hint: 'OTRO_CODIGO' })
  })

  it('si falla la subida del archivo, avisa en español y descarta lo pendiente', async () => {
    const storage = setupStorage({
      upload: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Network request failed' },
      }),
    })
    rpcMock.mockResolvedValue({ data: BEGIN_RESULT, error: null })

    await expect(
      createShiftMediaUpload(SHIFT_ID)(processedPhoto(), {
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toMatchObject({
      message: MEDIA_UPLOAD_FAILED_MESSAGE,
      hint: 'MEDIA_UPLOAD_FAILED',
    })

    // Nunca se confirma; se quita la fila y se borran las dos rutas.
    expect(rpcNames()).toEqual(['begin_shift_media', 'remove_shift_media'])
    expect(storage.remove).toHaveBeenCalledWith([
      'shift-1/media-1.jpg',
      'shift-1/media-1_thumb.jpg',
    ])
  })

  it('si falla la confirmación, traduce el código y descarta lo pendiente', async () => {
    const storage = setupStorage()
    rpcMock.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'confirm_shift_media'
          ? {
              data: null,
              error: {
                code: 'P0001',
                message: 'x',
                hint: 'MEDIA_UPLOAD_INCOMPLETE',
              },
            }
          : { data: BEGIN_RESULT, error: null },
      ),
    )

    await expect(
      createShiftMediaUpload(SHIFT_ID)(processedPhoto(), {
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toMatchObject({
      hint: 'MEDIA_UPLOAD_INCOMPLETE',
      message: MEDIA_HINT_MESSAGES.MEDIA_UPLOAD_INCOMPLETE,
    })
    expect(rpcNames()).toEqual([
      'begin_shift_media',
      'confirm_shift_media',
      'remove_shift_media',
    ])
    expect(storage.remove).toHaveBeenCalledTimes(1)
  })

  it('si la limpieza también falla, igual devuelve el error original', async () => {
    setupStorage({
      upload: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'boom' } }),
      remove: vi.fn().mockRejectedValue(new Error('sin red')),
    })
    rpcMock.mockResolvedValue({ data: BEGIN_RESULT, error: null })

    await expect(
      createShiftMediaUpload(SHIFT_ID)(processedPhoto(), {
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toMatchObject({ hint: 'MEDIA_UPLOAD_FAILED' })
  })

  it('con la señal ya abortada no llama a nada', async () => {
    const storage = setupStorage()
    const controller = new AbortController()
    controller.abort()

    await expect(
      createShiftMediaUpload(SHIFT_ID)(processedPhoto(), {
        signal: controller.signal,
        onProgress: () => undefined,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(rpcMock).not.toHaveBeenCalled()
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('si se aborta mientras sube el archivo, corta, no confirma y descarta lo pendiente', async () => {
    const controller = new AbortController()
    let resolveUpload: (value: unknown) => void = () => undefined
    const storage = setupStorage({
      upload: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpload = resolve
          }),
      ),
    })
    rpcMock.mockResolvedValue({ data: BEGIN_RESULT, error: null })

    const promise = createShiftMediaUpload(SHIFT_ID)(processedPhoto(), {
      signal: controller.signal,
      onProgress: () => undefined,
    })
    await vi.waitFor(() => expect(storage.upload).toHaveBeenCalledTimes(1))
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    resolveUpload({ data: {}, error: null })

    // Ni la miniatura ni la confirmación: solo se descarta lo pendiente.
    expect(storage.upload).toHaveBeenCalledTimes(1)
    expect(rpcNames()).toEqual(['begin_shift_media', 'remove_shift_media'])
    expect(storage.remove).toHaveBeenCalledTimes(1)
  })
})

describe('removeShiftMedia', () => {
  const MEDIA = {
    id: 'media-1',
    storagePath: 'shift-1/media-1.jpg',
    thumbPath: 'shift-1/media-1_thumb.jpg',
  }

  it('primero marca la fila y después borra el archivo y la miniatura', async () => {
    const calls: string[] = []
    setupStorage({
      remove: vi.fn().mockImplementation((paths: string[]) => {
        calls.push(`remove:${paths.join(',')}`)
        return Promise.resolve({ data: [], error: null })
      }),
    })
    rpcMock.mockImplementation((name: string) => {
      calls.push(`rpc:${name}`)
      return Promise.resolve({ data: {}, error: null })
    })

    await removeShiftMedia(MEDIA)

    expect(calls).toEqual([
      'rpc:remove_shift_media',
      'remove:shift-1/media-1.jpg,shift-1/media-1_thumb.jpg',
    ])
    expect(rpcMock).toHaveBeenCalledWith('remove_shift_media', {
      p_media_id: 'media-1',
    })
  })

  it('si la ventana cerró, avisa con el mensaje claro y no toca Storage', async () => {
    const storage = setupStorage()
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'x', hint: 'MEDIA_WINDOW_CLOSED' },
    })

    await expect(removeShiftMedia(MEDIA)).rejects.toMatchObject({
      hint: 'MEDIA_WINDOW_CLOSED',
      message: MEDIA_HINT_MESSAGES.MEDIA_WINDOW_CLOSED,
    })
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('si Storage no borra, no es un error: la fila ya quedó quitada', async () => {
    setupStorage({ remove: vi.fn().mockRejectedValue(new Error('sin red')) })
    rpcMock.mockResolvedValue({ data: {}, error: null })

    await expect(removeShiftMedia(MEDIA)).resolves.toBeUndefined()
  })
})

describe('fetchMyShiftMedia', () => {
  const ROW = {
    id: 'm1',
    shift_id: SHIFT_ID,
    kind: 'photo',
    storage_path: 'shift-1/m1.jpg',
    thumb_path: 'shift-1/m1_thumb.jpg',
    duration_s: null,
    captured_at: null,
    created_at: '2026-10-13T11:20:00Z',
    keep: false,
    expires_on: '2026-12-12',
    has_file: true,
  }

  it('lee lo propio del turno y firma las miniaturas en un solo pedido', async () => {
    fromMock.mockReturnValue(makeChainable({ data: [ROW], error: null }))
    const storage = setupStorage({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [
          {
            path: 'shift-1/m1_thumb.jpg',
            signedUrl: 'https://x/mini',
            error: null,
          },
        ],
        error: null,
      }),
    })

    const [media] = await fetchMyShiftMedia(SHIFT_ID, 'user-1')

    expect(fromMock).toHaveBeenCalledWith('v_shift_media')
    expect(storage.createSignedUrls).toHaveBeenCalledTimes(1)
    expect(media).toMatchObject({
      id: 'm1',
      kind: 'photo',
      thumbUrl: 'https://x/mini',
      takenAt: '2026-10-13T11:20:00Z',
      hasFile: true,
      expiresOn: '2026-12-12',
    })
  })

  it('usa captured_at como hora si se conoce', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [{ ...ROW, captured_at: '2026-10-13T11:05:00Z' }],
        error: null,
      }),
    )
    setupStorage()

    const [media] = await fetchMyShiftMedia(SHIFT_ID, 'user-1')
    expect(media?.takenAt).toBe('2026-10-13T11:05:00Z')
  })

  it('no firma nada de lo que ya venció (queda la constancia)', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [{ ...ROW, has_file: false }], error: null }),
    )
    const storage = setupStorage()

    const [media] = await fetchMyShiftMedia(SHIFT_ID, 'user-1')

    expect(storage.createSignedUrls).not.toHaveBeenCalled()
    expect(media).toMatchObject({ hasFile: false, thumbUrl: null })
  })

  it('traduce el error de la consulta', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: null, error: { message: 'boom', code: '500' } }),
    )
    setupStorage()

    await expect(fetchMyShiftMedia(SHIFT_ID, 'user-1')).rejects.toBeInstanceOf(
      ApiError,
    )
  })
})

describe('signMediaUrl', () => {
  it('devuelve la URL firmada del original', async () => {
    setupStorage()
    await expect(signMediaUrl('shift-1/m1.jpg')).resolves.toBe(
      'https://x/firmada',
    )
  })

  it('si no puede firmar, avisa en español', async () => {
    setupStorage({
      createSignedUrl: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'x' } }),
    })
    await expect(signMediaUrl('shift-1/m1.jpg')).rejects.toMatchObject({
      hint: 'MEDIA_URL_FAILED',
    })
  })
})

describe('mediaApiErrorMessage', () => {
  it('usa el mensaje del ApiError y, si es otro error, el de reserva', () => {
    expect(mediaApiErrorMessage(new ApiError('Hola.', 'X'))).toBe('Hola.')
    expect(mediaApiErrorMessage(new Error('boom'))).toBe(
      MEDIA_UPLOAD_FAILED_MESSAGE,
    )
    expect(mediaApiErrorMessage(new Error('boom'), 'Reserva.')).toBe('Reserva.')
  })
})
