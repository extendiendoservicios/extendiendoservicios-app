import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'

/**
 * ADM-07 edición de turno con fecha editable (P19.11d): advertencias antes de
 * confirmar, llamada con `p_date`, errores mapeados y fecha no editable si el
 * turno ya empezó.
 */

const {
  updateTimeMock,
  warningsMock,
  detailsMock,
  assignMock,
  toastError,
  toastWarning,
} = vi.hoisted(() => ({
  updateTimeMock: vi.fn(),
  warningsMock: vi.fn(),
  detailsMock: vi.fn(),
  assignMock: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}))

let mockShiftData: Record<string, unknown> = {}
let mockDetailData: Record<string, unknown> | undefined
let mockLeaves: {
  employeeId: string
  startsOn: string
  endsOn: string | null
}[] = []

// Radix/cmdk piden `scrollIntoView`, que jsdom no trae.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: toastWarning, error: toastError },
}))

vi.mock('@/features/employees/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/employees/queries')>()),
  useActiveEmployeeOptionsQuery: () => ({
    isLoading: false,
    data: [
      { profileId: 'e1', name: 'Ana Gómez', employeeNumber: 1 },
      { profileId: 'e2', name: 'Luis Díaz', employeeNumber: 2 },
      { profileId: 'e3', name: 'Marta Ruiz', employeeNumber: 3 },
    ],
  }),
  useLeavesInRangeQuery: () => ({ data: mockLeaves }),
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [] }),
}))

vi.mock('@/features/shifts/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/shifts/queries')>()),
  useShiftForEditQuery: () => ({
    isLoading: false,
    data: mockShiftData,
  }),
  useUpdateShiftTimeMutation: () => ({
    mutateAsync: updateTimeMock,
    isPending: false,
  }),
  useShiftDateWarningsMutation: () => ({
    mutateAsync: warningsMock,
    isPending: false,
  }),
}))

vi.mock('@/features/planning/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/planning/queries')>()),
  useUpdateShiftDetailsMutation: () => ({
    mutateAsync: detailsMock,
    isPending: false,
  }),
  useAssignEmployeeMutation: () => ({
    mutateAsync: assignMock,
    isPending: false,
  }),
  useShiftDetailQuery: () => ({ data: mockDetailData }),
}))

vi.mock('@/components/DatePicker', () => ({
  DatePicker: ({
    'aria-label': label,
    value,
    onValueChange,
  }: {
    'aria-label': string
    value?: Date
    onValueChange: (date: Date | undefined) => void
  }) => (
    <input
      aria-label={label}
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

function baseShift(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sh1',
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 's1',
    siteName: 'Centro',
    shiftDate: '2030-10-13',
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    requiredStaff: 1,
    status: 'assigned',
    notes: null,
    showInPrint: true,
    requiresPhotos: false,
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/turnos/sh1/editar']}>
        <Routes>
          <Route path="/admin/turnos/:id/editar" element={<ShiftFormPage />} />
          <Route path="/admin/planificacion" element={<Destino />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function changeDateAndSave() {
  fireEvent.change(screen.getByLabelText('Fecha del turno'), {
    target: { value: '2030-10-20' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
}

beforeEach(() => {
  mockShiftData = baseShift()
  mockDetailData = {
    startsAt: '2099-10-13T11:00:00Z',
    assignments: [
      {
        id: 'a1',
        employeeId: 'e1',
        employeeFirstName: 'Ana',
        employeeLastName: 'Gómez',
      },
    ],
  }
  mockLeaves = []
  assignMock.mockReset().mockResolvedValue({ assignment: {}, warnings: [] })
  toastWarning.mockReset()
  updateTimeMock.mockReset().mockResolvedValue(undefined)
  detailsMock.mockReset().mockResolvedValue(undefined)
  warningsMock
    .mockReset()
    .mockResolvedValue({ holiday: false, outsideAvailability: [] })
  toastError.mockReset()
})

describe('ShiftFormPage edición: fecha del turno', () => {
  it('explica que al mover de día se limpian los avisos', () => {
    renderPage()
    expect(
      screen.getByText(/se limpian los avisos de demora y de ausencia/),
    ).toBeInTheDocument()
  })

  it('sin cambiar la fecha no consulta advertencias ni manda la fecha', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(updateTimeMock).toHaveBeenCalled())
    expect(warningsMock).not.toHaveBeenCalled()
    const [args] = updateTimeMock.mock.calls[0] as [{ date?: string }]
    expect(args.date).toBeUndefined()
  })

  it('con fecha nueva y sin advertencias guarda con la fecha y lleva al día nuevo', async () => {
    renderPage()
    changeDateAndSave()

    await waitFor(() => expect(updateTimeMock).toHaveBeenCalled())
    expect(warningsMock).toHaveBeenCalledWith(
      expect.objectContaining({ shiftId: 'sh1', date: '2030-10-20' }),
    )
    expect(updateTimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ shiftId: 'sh1', date: '2030-10-20' }),
    )
    expect(
      await screen.findByText(/Calendario \?vista=dia&fecha=2030-10-20/),
    ).toBeInTheDocument()
  })

  it('con feriado o fuera de disponibilidad pide confirmar antes de guardar', async () => {
    warningsMock.mockResolvedValue({
      holiday: true,
      outsideAvailability: [{ employeeId: 'e1', employeeName: 'Ana Gómez' }],
    })
    renderPage()
    changeDateAndSave()

    expect(
      await screen.findByText('La fecha nueva es feriado.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Ana Gómez está fuera de su disponibilidad/),
    ).toBeInTheDocument()
    expect(updateTimeMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Mover igual' }))
    await waitFor(() => expect(updateTimeMock).toHaveBeenCalled())
    expect(updateTimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2030-10-20' }),
    )
  })

  it.each([
    ['SHIFT_DATE_TAKEN', 'Este servicio ya tiene otro turno ese día.'],
    ['SHIFT_DATE_IN_PAST', 'no puede ser anterior a hoy'],
    ['SHIFT_STARTED', 'ya empezó'],
  ])('mapea %s a un mensaje claro', async (hint, expected) => {
    updateTimeMock.mockRejectedValue(new ApiError('Mensaje del servidor', hint))
    renderPage()
    changeDateAndSave()
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0]?.[0]).toContain(expected)
  })

  it('ON_LEAVE muestra el mensaje del servidor con el nombre', async () => {
    updateTimeMock.mockRejectedValue(
      new ApiError('Ana Gómez está de licencia ese día.', 'ON_LEAVE'),
    )
    renderPage()
    changeDateAndSave()
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Ana Gómez está de licencia ese día.',
      ),
    )
  })

  it('si el turno ya empezó, la fecha no se ofrece editable', () => {
    mockShiftData = baseShift({ status: 'in_progress' })
    renderPage()
    expect(screen.queryByLabelText('Fecha del turno')).toBeNull()
    expect(screen.getByText(/la fecha no se puede cambiar/)).toBeInTheDocument()
  })
})

describe('ShiftFormPage edición: empleados asignados (OD-16)', () => {
  it('muestra los asignados y no ofrece a quien ya está en el turno', () => {
    mockShiftData = baseShift({ requiredStaff: 3 })
    renderPage()
    const asignados = screen.getByRole('list', {
      name: 'Empleados ya asignados',
    })
    expect(asignados).toHaveTextContent('Ana Gómez')

    fireEvent.click(
      screen.getByRole('combobox', { name: 'Sumar empleados al turno' }),
    )
    expect(screen.queryByRole('option', { name: /Ana Gómez/ })).toBeNull()
    expect(
      screen.getByRole('option', { name: /Luis Díaz/ }),
    ).toBeInTheDocument()
  })

  it('con la dotación completa no deja sumar a nadie', () => {
    renderPage()
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Sumar empleados al turno' }),
    )
    expect(screen.getByRole('option', { name: /Luis Díaz/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('quien está de licencia ese día no se puede elegir', () => {
    mockShiftData = baseShift({ requiredStaff: 3 })
    mockLeaves = [{ employeeId: 'e2', startsOn: '2030-10-01', endsOn: null }]
    renderPage()
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Sumar empleados al turno' }),
    )
    expect(screen.getByRole('option', { name: /Luis Díaz/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText('De licencia')).toBeInTheDocument()
  })

  it('al guardar asigna a los elegidos y avisa lo que el servidor rechaza', async () => {
    mockShiftData = baseShift({ requiredStaff: 3 })
    assignMock.mockImplementation((input: { employeeId: string }) =>
      input.employeeId === 'e3'
        ? Promise.reject(
            new ApiError('Marta Ruiz ya tiene un turno.', 'OVERLAP'),
          )
        : Promise.resolve({ assignment: {}, warnings: [] }),
    )
    renderPage()
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Sumar empleados al turno' }),
    )
    fireEvent.click(screen.getByRole('option', { name: /Luis Díaz/ }))
    fireEvent.click(screen.getByRole('option', { name: /Marta Ruiz/ }))
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(2))
    expect(assignMock).toHaveBeenCalledWith({
      shiftId: 'sh1',
      employeeId: 'e2',
    })
    expect(updateTimeMock).toHaveBeenCalled()
    await waitFor(() => expect(toastWarning).toHaveBeenCalled())
    expect(toastWarning.mock.calls[0]?.[0]).toContain('no se la pudo asignar')
  })

  it('sin elegir a nadie no llama a assign_employee', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(updateTimeMock).toHaveBeenCalled())
    expect(assignMock).not.toHaveBeenCalled()
  })
})
