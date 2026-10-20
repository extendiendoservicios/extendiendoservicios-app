import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ADM-07 alta de turno con «Repetir este turno» (AJ3-08): apagado usa
 * `create_shift`; encendido, el aviso en vivo de `preview_shift_series` y
 * `create_shift_series`.
 */

const {
  createShiftMock,
  createShiftSeriesMock,
  previewShiftSeriesMock,
  toastSuccess,
  toastWarning,
  toastError,
} = vi.hoisted(() => ({
  createShiftMock: vi.fn(),
  createShiftSeriesMock: vi.fn(),
  previewShiftSeriesMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, warning: toastWarning, error: toastError },
}))

vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  createShift: createShiftMock,
  createShiftSeries: createShiftSeriesMock,
  previewShiftSeries: previewShiftSeriesMock,
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [] }),
}))

vi.mock('@/features/clients/queries', () => ({
  useClientsQuery: () => ({
    data: [{ id: 'c1', tradeName: 'Limpia Ya', legalName: 'L SRL' }],
  }),
  useClientSitesQuery: () => ({
    data: [{ id: 's1', name: 'Sede Centro', status: 'active' }],
  }),
}))

vi.mock('@/features/employees/queries', () => ({
  useActiveEmployeeOptionsQuery: () => ({ data: [], isLoading: false }),
  useLeavesInRangeQuery: () => ({ data: [] }),
}))

vi.mock('@/features/settings/queries', () => ({
  useHolidaysQuery: () => ({ data: [] }),
}))

vi.mock('@/features/planning/components/EmployeeMultiPicker', () => ({
  EmployeeMultiPicker: () => <div />,
}))

// Los selectores reales son popovers: acá alcanzan cajas simples.
vi.mock('@/components/Combobox', () => ({
  Combobox: ({
    'aria-label': label,
    onValueChange,
  }: {
    'aria-label': string
    onValueChange: (value: string) => void
  }) => (
    <button
      type="button"
      onClick={() => onValueChange(label === 'Cliente' ? 'c1' : 's1')}
    >
      Elegir {label}
    </button>
  ),
}))

vi.mock('@/components/DatePicker', () => ({
  DatePicker: ({
    'aria-label': label,
    value,
    onValueChange,
    minDate,
    maxDate,
  }: {
    'aria-label': string
    value?: Date
    onValueChange: (date: Date | undefined) => void
    minDate?: Date
    maxDate?: Date
  }) => (
    <input
      aria-label={label}
      data-min={minDate ? minDate.toDateString() : ''}
      data-max={maxDate ? maxDate.toDateString() : ''}
      defaultValue={value ? value.toDateString() : ''}
      onChange={(event) =>
        onValueChange(
          event.target.value
            ? new Date(`${event.target.value}T00:00:00`)
            : undefined,
        )
      }
    />
  ),
}))

const { default: ShiftFormPage } = await import('./ShiftFormPage')

function Destino() {
  const location = useLocation()
  return <p>Calendario {location.search}</p>
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/turnos/nuevo']}>
        <Routes>
          <Route path="/admin/turnos/nuevo" element={<ShiftFormPage />} />
          <Route path="/admin/planificacion" element={<Destino />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function fillBasics() {
  fireEvent.click(screen.getByRole('button', { name: 'Elegir Cliente' }))
  fireEvent.click(screen.getByRole('button', { name: 'Elegir Sede' }))
  fireEvent.change(screen.getByLabelText('Fecha del turno'), {
    target: { value: '2026-10-13' },
  })
  fireEvent.change(document.getElementById('shift-start-time') as Element, {
    target: { value: '08:00' },
  })
  fireEvent.change(document.getElementById('shift-end-time') as Element, {
    target: { value: '12:00' },
  })
}

const SINGLE_RESULT = {
  shiftId: 'sh1',
  warnings: [],
  assigned: [],
  rejected: [],
}

beforeEach(() => {
  createShiftMock.mockReset().mockResolvedValue(SINGLE_RESULT)
  createShiftSeriesMock.mockReset().mockResolvedValue({
    seriesId: 'ser1',
    created: [
      {
        shiftId: 'a',
        shiftDate: '2026-10-13',
        warnings: [],
        assigned: [],
        rejected: [],
      },
      {
        shiftId: 'b',
        shiftDate: '2026-10-20',
        warnings: [],
        assigned: [],
        rejected: [],
      },
    ],
    holidaysSkipped: [],
  })
  previewShiftSeriesMock.mockReset().mockResolvedValue({
    dates: ['2026-10-13', '2026-10-20'],
    holidaysSkipped: [],
    count: 2,
  })
  toastSuccess.mockReset()
  toastWarning.mockReset()
  toastError.mockReset()
})

describe('ShiftFormPage — repetir el turno', () => {
  it('con el conmutador apagado crea un solo turno con create_shift', async () => {
    renderPage()
    fillBasics()
    expect(
      screen.getByRole('switch', { name: 'Repetir este turno' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))

    await waitFor(() => expect(createShiftMock).toHaveBeenCalledTimes(1))
    expect(createShiftSeriesMock).not.toHaveBeenCalled()
    expect(previewShiftSeriesMock).not.toHaveBeenCalled()
  })

  it('al encender tilda el día de la fecha elegida y pide la fecha «hasta»', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))

    // 13/10/2026 es martes.
    expect(screen.getByRole('checkbox', { name: 'Martes' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Lunes' })).not.toBeChecked()
    expect(screen.getByText('Crear también en feriados')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))
    expect(
      await screen.findByText('Elegí hasta qué fecha se repite.'),
    ).toBeInTheDocument()
    expect(createShiftSeriesMock).not.toHaveBeenCalled()
  })

  it('limita la fecha «hasta» a 3 meses desde «Desde»', () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    const hasta = screen.getByLabelText('Repetir hasta')
    expect(hasta.getAttribute('data-min')).toContain('Oct 13 2026')
    expect(hasta.getAttribute('data-max')).toContain('Jan 13 2027')
  })

  it('muestra el aviso en vivo y crea la serie con create_shift_series', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-11-17' },
    })

    expect(
      await screen.findByText('Se van a crear 2 turnos.'),
    ).toBeInTheDocument()
    expect(previewShiftSeriesMock).toHaveBeenCalledWith({
      from: '2026-10-13',
      to: '2026-11-17',
      weekdays: [2],
      weeksOfMonth: null,
      worksOnHolidays: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))
    await waitFor(() => expect(createShiftSeriesMock).toHaveBeenCalledTimes(1))
    expect(createShiftMock).not.toHaveBeenCalled()
    expect(createShiftSeriesMock.mock.calls[0]?.[0]).toMatchObject({
      clientId: 'c1',
      siteId: 's1',
      start: '08:00',
      end: '12:00',
      from: '2026-10-13',
      to: '2026-11-17',
      weekdays: [2],
      weeksOfMonth: null,
      worksOnHolidays: false,
    })
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Se crearon 2 turnos.'),
    )
    expect(
      await screen.findByText(/Calendario \?vista=dia&fecha=2026-10-13/),
    ).toBeInTheDocument()
  })

  it('con 0 fechas avisa y deshabilita el botón de crear', async () => {
    previewShiftSeriesMock.mockResolvedValue({
      dates: [],
      holidaysSkipped: [],
      count: 0,
    })
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-10-14' },
    })

    expect(
      await screen.findByText('Ninguna fecha cumple la regla elegida.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear turnos' })).toBeDisabled()
  })

  it('informa los feriados que se saltean', async () => {
    previewShiftSeriesMock.mockResolvedValue({
      dates: ['2026-10-13'],
      holidaysSkipped: ['2026-10-20'],
      count: 1,
    })
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-10-27' },
    })

    expect(
      await screen.findByText('Se saltea 1 feriado: mar 20 oct.'),
    ).toBeInTheDocument()
  })

  it('muestra por fecha los empleados rechazados antes de volver', async () => {
    createShiftSeriesMock.mockResolvedValue({
      seriesId: 'ser1',
      created: [
        {
          shiftId: 'a',
          shiftDate: '2026-10-13',
          warnings: [],
          assigned: [],
          rejected: [
            {
              employeeId: 'e1',
              employeeName: 'Ana Gómez',
              code: 'ASSIGNMENT_OVERLAP',
              message: 'Ya tiene otro turno en ese horario.',
            },
          ],
        },
      ],
      holidaysSkipped: [],
    })
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-11-17' },
    })
    await screen.findByText('Se van a crear 2 turnos.')
    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))

    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1))
    expect(toastWarning.mock.calls[0]?.[0]).toBe(
      'Se creó 1 turno, pero a algunas personas no se las pudo asignar:',
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('muestra el message del servidor si falla la creación', async () => {
    const { ApiError } = await import('@/api/errors')
    createShiftSeriesMock.mockRejectedValue(
      new ApiError(
        'La sede no está activa. (turno del 20/10/2026)',
        'SITE_NOT_ACTIVE',
      ),
    )
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-11-17' },
    })
    await screen.findByText('Se van a crear 2 turnos.')
    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'La sede no está activa. (turno del 20/10/2026)',
      ),
    )
  })
})

describe('ShiftFormPage: casilla «Pide fotos» (módulo H)', () => {
  it('viene apagada y create_shift recibe requiresPhotos false', async () => {
    renderPage()
    fillBasics()
    expect(
      screen.getByRole('checkbox', { name: 'Pide fotos' }),
    ).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))
    await waitFor(() => expect(createShiftMock).toHaveBeenCalledTimes(1))
    expect(createShiftMock.mock.calls[0]?.[0]).toMatchObject({
      requiresPhotos: false,
    })
  })

  it('tildada, create_shift recibe requiresPhotos true', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pide fotos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear turno' }))
    await waitFor(() => expect(createShiftMock).toHaveBeenCalledTimes(1))
    expect(createShiftMock.mock.calls[0]?.[0]).toMatchObject({
      requiresPhotos: true,
    })
  })

  it('en una repetición, create_shift_series también la recibe', async () => {
    renderPage()
    fillBasics()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pide fotos' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir este turno' }))
    fireEvent.change(screen.getByLabelText('Repetir hasta'), {
      target: { value: '2026-11-17' },
    })
    await screen.findByText('Se van a crear 2 turnos.')
    fireEvent.click(screen.getByRole('button', { name: 'Crear turnos' }))
    await waitFor(() => expect(createShiftSeriesMock).toHaveBeenCalledTimes(1))
    expect(createShiftSeriesMock.mock.calls[0]?.[0]).toMatchObject({
      requiresPhotos: true,
    })
  })
})
