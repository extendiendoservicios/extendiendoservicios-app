import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Alta de empleado con foto (AJ2-07): la foto elegida se sube al bucket
 * `avatars` con el `profile_id` que devuelve el alta; si falla, la cuenta
 * queda creada, se avisa y se navega igual a la ficha.
 */

const {
  createEmployeeUserMock,
  savePhotoMock,
  toastSuccess,
  toastWarning,
  toastError,
} = vi.hoisted(() => ({
  createEmployeeUserMock: vi.fn(),
  savePhotoMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, warning: toastWarning, error: toastError },
}))

vi.mock('@/api/employees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/employees')>()),
  createEmployeeUser: createEmployeeUserMock,
  fetchSuggestedEmployeeNumber: () => Promise.resolve(7),
}))

vi.mock('@/api/photos', () => ({ savePhoto: savePhotoMock }))

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

const { default: EmployeeFormPage } = await import('./EmployeeFormPage')

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/empleados/nuevo']}>
        <Routes>
          <Route path="/admin/empleados/nuevo" element={<EmployeeFormPage />} />
          <Route
            path="/admin/empleados/:id"
            element={<p>Ficha del empleado</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function fillRequiredFields() {
  const values: Record<string, string> = {
    'employee-email': 'ana@ejemplo.com',
    'employee-password': 'clave-segura-1',
    'employee-first-name': 'Ana',
    'employee-last-name': 'Gómez',
    'employee-dni': '30123456',
  }
  for (const [id, value] of Object.entries(values)) {
    fireEvent.change(document.getElementById(id) as HTMLInputElement, {
      target: { value },
    })
  }
}

beforeEach(() => {
  createEmployeeUserMock
    .mockReset()
    .mockResolvedValue({ profileId: 'perfil-nuevo', employeeNumber: 7 })
  savePhotoMock.mockReset().mockResolvedValue('perfil-nuevo/foto.jpg')
  toastSuccess.mockReset()
  toastWarning.mockReset()
  toastError.mockReset()
})

describe('EmployeeFormPage — alta con foto', () => {
  it('crea la cuenta, sube la foto como avatar del profile_id nuevo y navega a la ficha', async () => {
    renderPage()
    fillRequiredFields()
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir foto de prueba' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))

    expect(await screen.findByText('Ficha del empleado')).toBeInTheDocument()
    expect(savePhotoMock).toHaveBeenCalledWith(
      'profile',
      'perfil-nuevo',
      expect.any(Blob),
    )
    expect(toastSuccess).toHaveBeenCalled()
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('si la foto falla, avisa y navega igual (el alta no se deshace)', async () => {
    savePhotoMock.mockRejectedValue(new Error('sin red'))
    renderPage()
    fillRequiredFields()
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir foto de prueba' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))

    expect(await screen.findByText('Ficha del empleado')).toBeInTheDocument()
    expect(toastWarning).toHaveBeenCalledWith(
      'Se creó Ana Gómez, pero no se pudo guardar la foto. Probá de nuevo desde Editar.',
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('sin foto elegida no intenta subir nada', async () => {
    renderPage()
    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))

    expect(await screen.findByText('Ficha del empleado')).toBeInTheDocument()
    expect(savePhotoMock).not.toHaveBeenCalled()
  })
})
