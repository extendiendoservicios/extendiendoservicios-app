import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fetchRetentionMock,
  setRetentionMock,
  usageMock,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  fetchRetentionMock: vi.fn(),
  setRetentionMock: vi.fn(),
  usageMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@/api/mediaAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/mediaAdmin')>()),
  fetchMediaRetention: fetchRetentionMock,
  setMediaRetention: setRetentionMock,
  fetchStorageUsage: usageMock,
}))

const { MediaRetentionSection } = await import('./MediaRetentionSection')

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MediaRetentionSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchRetentionMock.mockResolvedValue({ photoDays: 60, videoDays: 30 })
  usageMock.mockResolvedValue({
    totalBytes: 1024 * 1024,
    limitBytes: 1073741824,
    percent: 0.1,
    level: 'ok',
    buckets: [],
  })
})

describe('ADM-28: sección «Fotos y videos»', () => {
  it('muestra los plazos vigentes, la explicación de «Conservar» y el medidor', async () => {
    renderSection()
    expect(await screen.findByLabelText(/Las fotos vencen/)).toHaveValue(60)
    expect(screen.getByLabelText(/Los videos vencen/)).toHaveValue(30)
    expect(screen.getByText(/no vence nunca/)).toBeInTheDocument()
    expect(
      await screen.findByRole('progressbar', { name: 'Espacio usado' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Fotos y videos' }),
    ).toHaveAttribute('href', '/admin/fotos')
  })

  it('guarda los dos plazos con set_media_retention', async () => {
    setRetentionMock.mockResolvedValue({ photoDays: 90, videoDays: 30 })
    renderSection()

    const photos = await screen.findByLabelText(/Las fotos vencen/)
    fireEvent.change(photos, { target: { value: '90' } })
    const save = screen.getByRole('button', { name: 'Guardar plazos' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)

    await waitFor(() =>
      expect(setRetentionMock).toHaveBeenCalledWith({
        photoDays: 90,
        videoDays: 30,
      }),
    )
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Guardamos los plazos de fotos y videos.',
      ),
    )
  })

  it('rechaza fuera de 7 a 365 días sin llamar al servidor', async () => {
    renderSection()
    const videos = await screen.findByLabelText(/Los videos vencen/)
    fireEvent.change(videos, { target: { value: '400' } })
    const save = screen.getByRole('button', { name: 'Guardar plazos' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)
    expect(
      await screen.findByText('Tiene que ser de 7 a 365 días.'),
    ).toBeInTheDocument()
    expect(setRetentionMock).not.toHaveBeenCalled()
  })

  it('muestra el error del servidor tal cual', async () => {
    setRetentionMock.mockRejectedValue(
      Object.assign(new Error('Los plazos tienen que ser de 7 a 365 días.'), {
        name: 'ApiError',
        hint: 'RETENTION_OUT_OF_RANGE',
      }),
    )
    renderSection()
    const photos = await screen.findByLabelText(/Las fotos vencen/)
    fireEvent.change(photos, { target: { value: '45' } })
    const save = screen.getByRole('button', { name: 'Guardar plazos' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)
    await waitFor(() => expect(toastError).toHaveBeenCalled())
  })

  it('el botón queda apagado mientras no cambie nada', async () => {
    renderSection()
    await screen.findByLabelText(/Las fotos vencen/)
    expect(
      screen.getByRole('button', { name: 'Guardar plazos' }),
    ).toBeDisabled()
  })
})
