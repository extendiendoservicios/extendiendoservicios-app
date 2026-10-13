import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MediaCapture } from './MediaCapture'
import { MediaError } from '@/lib/media/errors'
import type { MediaUploadContext, ProcessedMedia } from '@/lib/media/types'

const compressImage = vi.fn()
const compressVideo = vi.fn()
vi.mock('@/lib/media/compressImage', () => ({
  compressImage: (...args: unknown[]) => compressImage(...args) as unknown,
}))
vi.mock('@/lib/media/compressVideo', () => ({
  compressVideo: (...args: unknown[]) => compressVideo(...args) as unknown,
}))

function processed(kind: 'photo' | 'video' = 'photo'): ProcessedMedia {
  return {
    kind,
    file: new Blob(['x'], {
      type: kind === 'photo' ? 'image/jpeg' : 'video/mp4',
    }),
    mimeType: kind === 'photo' ? 'image/jpeg' : 'video/mp4',
    extension: kind === 'photo' ? 'jpg' : 'mp4',
    thumbnail: new Blob(['t'], { type: 'image/jpeg' }),
    width: 1280,
    height: 960,
    bytes: 1,
    thumbnailBytes: 1,
    totalBytes: 2,
    durationSeconds: kind === 'video' ? 10 : null,
    capturedAt: null,
  }
}

const photoFile = (name = 'foto.jpg') =>
  new File(['x'], name, { type: 'image/jpeg' })
const videoFile = (name = 'video.mp4') =>
  new File(['x'], name, { type: 'video/mp4' })

function pick(testId: string, files: File[]) {
  fireEvent.change(screen.getByTestId(testId), { target: { files } })
}

beforeEach(() => {
  compressImage.mockReset()
  compressVideo.mockReset()
  compressImage.mockImplementation(() => Promise.resolve(processed('photo')))
  compressVideo.mockImplementation(() => Promise.resolve(processed('video')))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MediaCapture: botones y topes', () => {
  it('muestra los tres botones y el contador «3 de 10 fotos» / «1 de 2 videos»', () => {
    vi.stubGlobal('MediaRecorder', class {})
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn() },
    })
    render(<MediaCapture upload={vi.fn()} counts={{ photos: 3, videos: 1 }} />)
    expect(screen.getByRole('button', { name: 'Sacar foto' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Elegir de la galería' }),
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Grabar video' })).toBeEnabled()
    expect(screen.getByText('3 de 10 fotos')).toBeInTheDocument()
    expect(screen.getByText('1 de 2 videos')).toBeInTheDocument()
  })

  it('la cámara usa capture="environment" y la galería no usa capture', () => {
    render(<MediaCapture upload={vi.fn()} counts={{ photos: 0, videos: 0 }} />)
    const camera = screen.getByTestId('media-camera-input')
    const gallery = screen.getByTestId('media-gallery-input')
    expect(camera).toHaveAttribute('capture', 'environment')
    expect(camera).toHaveAttribute('accept', 'image/*')
    expect(gallery).not.toHaveAttribute('capture')
    expect(gallery).toHaveAttribute('accept', 'image/*,video/*')
  })

  it('con el tope de fotos, «Sacar foto» se apaga y la galería solo acepta videos', () => {
    render(<MediaCapture upload={vi.fn()} counts={{ photos: 10, videos: 0 }} />)
    expect(screen.getByRole('button', { name: 'Sacar foto' })).toBeDisabled()
    expect(screen.getByTestId('media-gallery-input')).toHaveAttribute(
      'accept',
      'video/*',
    )
    expect(screen.getByText('10 de 10 fotos')).toBeInTheDocument()
  })

  it('con el tope de videos, «Grabar video» se apaga', () => {
    vi.stubGlobal('MediaRecorder', class {})
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn() },
    })
    render(<MediaCapture upload={vi.fn()} counts={{ photos: 0, videos: 2 }} />)
    expect(screen.getByRole('button', { name: 'Grabar video' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sacar foto' })).toBeEnabled()
  })

  it('con los dos topes llenos, la galería también se apaga', () => {
    render(<MediaCapture upload={vi.fn()} counts={{ photos: 10, videos: 2 }} />)
    expect(
      screen.getByRole('button', { name: 'Elegir de la galería' }),
    ).toBeDisabled()
  })

  it('respeta topes distintos a los de por defecto', () => {
    render(
      <MediaCapture
        upload={vi.fn()}
        counts={{ photos: 1, videos: 0 }}
        limits={{ photos: 4, videos: 1 }}
      />,
    )
    expect(screen.getByText('1 de 4 fotos')).toBeInTheDocument()
    expect(screen.getByText('0 de 1 video')).toBeInTheDocument()
  })

  it('sin la grabación del navegador, no ofrece «Grabar video»', () => {
    render(<MediaCapture upload={vi.fn()} counts={{ photos: 0, videos: 0 }} />)
    expect(screen.queryByRole('button', { name: 'Grabar video' })).toBeNull()
  })
})

describe('MediaCapture: deshabilitado y sede sin fotos', () => {
  it('deshabilitado apaga los botones y explica el motivo', () => {
    render(
      <MediaCapture
        upload={vi.fn()}
        counts={{ photos: 0, videos: 0 }}
        disabled
        disabledReason="Ya pasó el plazo para subir fotos de este turno."
      />,
    )
    expect(screen.getByRole('button', { name: 'Sacar foto' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Elegir de la galería' }),
    ).toBeDisabled()
    expect(
      screen.getByText('Ya pasó el plazo para subir fotos de este turno.'),
    ).toBeInTheDocument()
  })

  it('sede sin fotos: solo el aviso, sin botones ni contadores', () => {
    render(
      <MediaCapture
        upload={vi.fn()}
        counts={{ photos: 0, videos: 0 }}
        photosNotAllowed
      />,
    )
    expect(
      screen.getByText('En esta sede no se permiten fotos.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/de 10 fotos/)).toBeNull()
    expect(screen.queryByTestId('media-camera-input')).toBeNull()
  })
})

describe('MediaCapture: cola de subida', () => {
  it('comprime, sube con el contexto y avisa al terminar', async () => {
    const upload = vi.fn((_media: ProcessedMedia, ctx: MediaUploadContext) => {
      ctx.onProgress(0.5)
      return Promise.resolve({ id: 'media-1' })
    })
    const onUploaded = vi.fn()
    render(
      <MediaCapture
        upload={upload}
        onUploaded={onUploaded}
        counts={{ photos: 0, videos: 0 }}
      />,
    )
    pick('media-camera-input', [photoFile()])

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
    expect(compressImage).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0]?.[0].kind).toBe('photo')
    expect(upload.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal)
    expect(onUploaded.mock.calls[0]?.[0]).toEqual({ id: 'media-1' })
    expect(await screen.findByText('Foto subida')).toBeInTheDocument()
  })

  it('muestra el avance mientras sube', async () => {
    let report: (n: number) => void = () => undefined
    let finish: () => void = () => undefined
    const upload = vi.fn(
      (_m: ProcessedMedia, ctx: MediaUploadContext) =>
        new Promise<{ id: string }>((resolve) => {
          report = ctx.onProgress
          finish = () => resolve({ id: 'x' })
        }),
    )
    render(<MediaCapture upload={upload} counts={{ photos: 0, videos: 0 }} />)
    pick('media-camera-input', [photoFile()])
    await waitFor(() => expect(upload).toHaveBeenCalled())
    act(() => report(0.4))
    expect(await screen.findByText('Subiendo… 40 %')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '40',
    )
    await act(async () => {
      finish()
      await Promise.resolve()
    })
  })

  it('el archivo en cola cuenta para el tope mientras se sube', async () => {
    let finish: () => void = () => undefined
    const upload = vi.fn(
      () =>
        new Promise<{ id: string }>(
          (resolve) => (finish = () => resolve({ id: 'x' })),
        ),
    )
    render(<MediaCapture upload={upload} counts={{ photos: 9, videos: 0 }} />)
    expect(screen.getByText('9 de 10 fotos')).toBeInTheDocument()
    pick('media-camera-input', [photoFile()])
    expect(await screen.findByText('10 de 10 fotos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sacar foto' })).toBeDisabled()
    await act(async () => {
      finish()
      await Promise.resolve()
    })
  })

  it('si la subida falla muestra el motivo y «Reintentar» no vuelve a comprimir', async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error('No hay conexión. Probá de nuevo.'))
      .mockResolvedValueOnce({ id: 'media-2' })
    render(<MediaCapture upload={upload} counts={{ photos: 0, videos: 0 }} />)
    pick('media-camera-input', [photoFile()])

    // El mensaje está en la fila y también en la región que lee el lector de pantalla.
    expect(
      await within(await screen.findByRole('list')).findByText(
        'No hay conexión. Probá de nuevo.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Foto subida')).toBeInTheDocument()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(compressImage).toHaveBeenCalledTimes(1)
    // Se reintentó con el mismo archivo ya comprimido.
    expect(upload.mock.calls[1]?.[0]).toBe(upload.mock.calls[0]?.[0])
  })

  it('un video demasiado largo se explica y no ofrece reintentar', async () => {
    compressVideo.mockRejectedValue(new MediaError('video_too_long'))
    const upload = vi.fn()
    render(<MediaCapture upload={upload} counts={{ photos: 0, videos: 0 }} />)
    pick('media-gallery-input', [videoFile()])

    expect(
      await within(await screen.findByRole('list')).findByText(
        'El video dura más de 30 segundos. Elegí uno más corto.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Descartar video.mp4' }),
    ).toBeInTheDocument()
    expect(upload).not.toHaveBeenCalled()
  })

  it('cancelar una subida en curso la saca de la cola', async () => {
    let signal: AbortSignal | undefined
    const upload = vi.fn(
      (_m: ProcessedMedia, ctx: MediaUploadContext) =>
        new Promise<{ id: string }>((_resolve, reject) => {
          signal = ctx.signal
          ctx.signal.addEventListener('abort', () => reject(new Error('abort')))
        }),
    )
    render(<MediaCapture upload={upload} counts={{ photos: 0, videos: 0 }} />)
    pick('media-camera-input', [photoFile('a.jpg')])
    await waitFor(() => expect(upload).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar a.jpg' }))
    await waitFor(() => expect(signal?.aborted).toBe(true))
    await waitFor(() => expect(screen.queryByText('a.jpg')).toBeNull())
  })

  it('elegir más de lo que entra: toma lo que cabe y avisa el tope', async () => {
    const upload = vi.fn(() => Promise.resolve({ id: 'x' }))
    render(<MediaCapture upload={upload} counts={{ photos: 8, videos: 0 }} />)
    pick('media-gallery-input', [
      photoFile('1.jpg'),
      photoFile('2.jpg'),
      photoFile('3.jpg'),
    ])
    expect(
      await screen.findByText('Ya llegaste al tope de 10 fotos de este turno.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(compressImage).toHaveBeenCalledTimes(2)
  })

  it('un archivo que no es foto ni video se rechaza con un aviso', () => {
    render(<MediaCapture upload={vi.fn()} counts={{ photos: 0, videos: 0 }} />)
    pick('media-gallery-input', [
      new File(['x'], 'nota.pdf', { type: 'application/pdf' }),
    ])
    expect(
      screen.getByText(
        'Ese archivo no es una foto ni un video que podamos usar.',
      ),
    ).toBeInTheDocument()
    expect(compressImage).not.toHaveBeenCalled()
  })

  it('avisa que hay que dejar la pantalla abierta cuando el video va en tiempo real', async () => {
    compressVideo.mockImplementation(
      (_file: File, opts: { onProgress: (p: unknown) => void }) => {
        opts.onProgress({ fraction: 0.2, mode: 'realtime' })
        return new Promise(() => undefined)
      },
    )
    render(<MediaCapture upload={vi.fn()} counts={{ photos: 0, videos: 0 }} />)
    pick('media-gallery-input', [videoFile()])
    expect(
      await screen.findByText(/Dejá la pantalla abierta/),
    ).toBeInTheDocument()
  })
})
