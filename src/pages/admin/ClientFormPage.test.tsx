import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Alta de cliente con foto (AJ2-07): la foto elegida se sube después de
 * crear el cliente; si la subida falla, el alta no se deshace, se avisa y se
 * navega igual a la ficha.
 */

const {
  createClientMock,
  savePhotoMock,
  toastSuccess,
  toastWarning,
  toastError,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  savePhotoMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, warning: toastWarning, error: toastError },
}))

vi.mock('@/api/clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/clients')>()),
  createClient: createClientMock,
}))

vi.mock('@/api/photos', () => ({
  savePhoto: savePhotoMock,
  clientPhotoUrl: (path: string) => path,
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'admin-1' }),
}))

// El recorte real necesita <canvas>: acá el selector solo entrega una foto.
vi.mock('@/components/PendingPhotoPicker', () => ({
  PendingPhotoPicker: ({
    onChange,
  }: {
    onChange: (blob: Blob | null) => void
  }) => (
    <button
      type="button"
      onClick={() => onChange(new Blob(['x'], { type: 'image/jpeg' }))}
    >
      Elegir foto de prueba
    </button>
  ),
}))

vi.mock('@/components/map', () => ({
  MapPicker: () => <div />,
}))

const { default: ClientFormPage } = await import('./ClientFormPage')

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/clientes/nuevo']}>
        <Routes>
          <Route path="/admin/clientes/nuevo" element={<ClientFormPage />} />
          <Route
            path="/admin/clientes/:id"
            element={<p>Ficha del cliente</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  createClientMock.mockReset().mockResolvedValue({ id: 'cli-nuevo' })
  savePhotoMock.mockReset().mockResolvedValue('cli-nuevo/foto.jpg')
  toastSuccess.mockReset()
  toastWarning.mockReset()
  toastError.mockReset()
})

describe('ClientFormPage — alta con foto', () => {
  it('crea el cliente, sube la foto con el id nuevo y navega a la ficha', async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('Razón social'), {
      target: { value: 'Limpiolux SA' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir foto de prueba' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(await screen.findByText('Ficha del cliente')).toBeInTheDocument()
    expect(savePhotoMock).toHaveBeenCalledWith(
      'client',
      'cli-nuevo',
      expect.any(Blob),
    )
    expect(toastSuccess).toHaveBeenCalledWith('Creamos el cliente.')
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('si la foto falla, avisa y navega igual (el alta no se deshace)', async () => {
    savePhotoMock.mockRejectedValue(new Error('sin red'))
    renderPage()

    fireEvent.change(screen.getByLabelText('Razón social'), {
      target: { value: 'Limpiolux SA' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir foto de prueba' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(await screen.findByText('Ficha del cliente')).toBeInTheDocument()
    expect(toastWarning).toHaveBeenCalledWith(
      'Se creó Limpiolux SA, pero no se pudo guardar la foto. Probá de nuevo desde Editar.',
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('sin foto elegida no intenta subir nada', async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('Razón social'), {
      target: { value: 'Limpiolux SA' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    await waitFor(() => expect(createClientMock).toHaveBeenCalled())
    expect(await screen.findByText('Ficha del cliente')).toBeInTheDocument()
    expect(savePhotoMock).not.toHaveBeenCalled()
  })
})
