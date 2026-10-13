import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VideoRecorderDialog } from './VideoRecorderDialog'
import { MediaError } from '@/lib/media/errors'
import type { ProcessedMedia } from '@/lib/media/types'
import type { VideoRecorderSession } from '@/lib/media/recordVideo'

const recordVideo = vi.fn()
vi.mock('@/lib/media/recordVideo', () => ({
  recordVideo: (...args: unknown[]) => recordVideo(...args) as unknown,
}))

const media = {
  kind: 'video',
  durationSeconds: 8,
  totalBytes: 10,
} as unknown as ProcessedMedia

function fakeSession() {
  let resolve!: (m: ProcessedMedia) => void
  const result = new Promise<ProcessedMedia>((r) => (resolve = r))
  const session = {
    stream: {} as MediaStream,
    format: {
      recorderType: 'video/webm',
      mimeType: 'video/webm',
      extension: 'webm',
    },
    start: vi.fn(),
    stop: vi.fn(() => resolve(media)),
    dispose: vi.fn(),
    result,
  } as unknown as VideoRecorderSession
  return session
}

beforeEach(() => {
  recordVideo.mockReset()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() =>
    Promise.resolve(),
  )
})

describe('VideoRecorderDialog', () => {
  it('abre la cámara, graba, detiene y entrega el video', async () => {
    const session = fakeSession()
    recordVideo.mockResolvedValue(session)
    const onRecorded = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <VideoRecorderDialog
        open
        onOpenChange={onOpenChange}
        onRecorded={onRecorded}
      />,
    )
    expect(
      screen.getByRole('dialog', { name: 'Grabar video' }),
    ).toBeInTheDocument()

    const record = await screen.findByRole('button', {
      name: 'Empezar a grabar',
    })
    await waitFor(() => expect(record).toBeEnabled())
    expect(screen.getByText(/Máximo 30 segundos/)).toBeInTheDocument()

    fireEvent.click(record)
    expect(session.start).toHaveBeenCalled()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Detener la grabación' }),
    )
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(media))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(session.dispose).toHaveBeenCalled()
  })

  it('muestra el motivo si no hay permiso para la cámara', async () => {
    recordVideo.mockRejectedValue(new MediaError('camera_denied'))
    render(
      <VideoRecorderDialog open onOpenChange={vi.fn()} onRecorded={vi.fn()} />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No tenemos permiso para usar la cámara',
    )
  })

  it('cancelar libera la cámara y no entrega nada', async () => {
    const session = fakeSession()
    recordVideo.mockResolvedValue(session)
    const onRecorded = vi.fn()
    const onOpenChange = vi.fn()
    const { unmount } = render(
      <VideoRecorderDialog
        open
        onOpenChange={onOpenChange}
        onRecorded={onRecorded}
      />,
    )
    await screen.findByRole('button', { name: 'Empezar a grabar' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    unmount()
    expect(session.dispose).toHaveBeenCalled()
    expect(onRecorded).not.toHaveBeenCalled()
  })
})
