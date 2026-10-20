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

const { updateTimeMock, warningsMock, detailsMock, toastError } = vi.hoisted(
  () => ({
    updateTimeMock: vi.fn(),
    warningsMock: vi.fn(),
    detailsMock: vi.fn(),
    toastError: vi.fn(),
  }),
)

let mockShiftData: Record<string, unknown> = {}

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: toastError },
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
