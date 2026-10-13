import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mediaRow } from '@/features/media/testRows'

const { keepMock, originalUrlMock, toastSuccess, toastError } = vi.hoisted(
  () => ({
    keepMock: vi.fn(),
    originalUrlMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  }),
)

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@/api/mediaAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/mediaAdmin')>()),
  setShiftMediaKeep: keepMock,
  createOriginalSignedUrl: originalUrlMock,
  fetchShiftTimes: vi.fn().mockResolvedValue([]),
  createThumbSignedUrls: vi
    .fn()
    .mockResolvedValue(new Map([['sh1/m1_thumb.jpg', 'https://s/t1']])),
}))

const { ShiftMediaSection } = await import('./ShiftMediaSection')

function renderSection(
  props: Partial<React.ComponentProps<typeof ShiftMediaSection>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ShiftMediaSection
        rows={[mediaRow()]}
        isLoading={false}
        emptyMessage="Todavía no hay nada."
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  keepMock.mockReset()
  originalUrlMock.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  originalUrlMock.mockResolvedValue('https://s/original.jpg')
})

describe('ShiftMediaSection (ADM-06 y ADM-15)', () => {
  it('agrupa las miniaturas por persona con la cuenta de cada una', () => {
    renderSection({
      rows: [
        mediaRow({ id: 'a' }),
        mediaRow({ id: 'b', kind: 'video', durationSeconds: 12 }),
        mediaRow({
          id: 'c',
          uploadedBy: 'p2',
          uploaderName: 'Luis Gómez',
          uploaderRole: 'supervisor',
        }),
      ],
    })
    expect(
      screen.getByRole('heading', { name: 'Fotos y videos' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument()
    expect(screen.getByText('1 foto · 1 video')).toBeInTheDocument()
    expect(screen.getByText('Luis Gómez · Supervisión')).toBeInTheDocument()
  })

  it('muestra «Sin fotos» cuando el turno las pide y no hay ninguna', () => {
    renderSection({
      rows: [],
      requiresPhotos: true,
      missingPhotos: true,
      emptyMessage: 'Todavía no subieron fotos ni videos de este turno.',
    })
    expect(screen.getByText('Sin fotos')).toBeInTheDocument()
    expect(screen.getByText('Pide fotos')).toBeInTheDocument()
    expect(
      screen.getByText('Todavía no subieron fotos ni videos de este turno.'),
    ).toBeInTheDocument()
  })

  it('no muestra la marca si no corresponde', () => {
    renderSection({ requiresPhotos: false, missingPhotos: false })
    expect(screen.queryByText('Sin fotos')).not.toBeInTheDocument()
    expect(screen.queryByText('Pide fotos')).not.toBeInTheDocument()
  })

  it('lo vencido aparece como constancia gris, sin abrirse', () => {
    renderSection({ rows: [mediaRow({ hasFile: false })] })
    expect(screen.getByText('Vencida')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Foto de Ana Pérez/ }),
    ).not.toBeInTheDocument()
  })

  it('muestra el mensaje vacío del ADM-15', () => {
    renderSection({
      rows: [],
      emptyMessage: 'El supervisor no subió fotos ni videos.',
    })
    expect(
      screen.getByText('El supervisor no subió fotos ni videos.'),
    ).toBeInTheDocument()
  })

  it('abre el visor con «Conservar» y «Descargar», y marca el archivo', async () => {
    keepMock.mockResolvedValue({ id: 'm1', keep: true })
    renderSection()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Foto de Ana Pérez, 08:15' }),
    )
    expect(
      await screen.findByRole('button', { name: 'Descargar' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Conservar' }))

    await waitFor(() => expect(keepMock).toHaveBeenCalledWith('m1', true))
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Lo marcamos para conservar: ya no vence.',
      ),
    )
    // La URL del original se pidió al abrir el visor, no antes.
    expect(originalUrlMock).toHaveBeenCalledWith('sh1/m1.jpg')
  })

  it('un archivo ya conservado ofrece «Dejar de conservar» y muestra el error del servidor', async () => {
    keepMock.mockRejectedValue(
      Object.assign(new Error('El archivo ya venció.'), {
        name: 'ApiError',
        hint: 'MEDIA_EXPIRED',
      }),
    )
    renderSection({ rows: [mediaRow({ keep: true })] })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Foto de Ana Pérez, 08:15' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Dejar de conservar' }),
    )
    await waitFor(() => expect(keepMock).toHaveBeenCalledWith('m1', false))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
  })
})
