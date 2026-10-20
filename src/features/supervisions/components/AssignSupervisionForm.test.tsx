import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShiftListRow } from '@/api/shifts'
import { ApiError } from '@/api/errors'
import { AssignSupervisionForm } from './AssignSupervisionForm'

/**
 * ADM-14 (SUP-009): mismo patrón que `RecordAttendanceSheet.test.tsx` -- se
 * mockean las consultas y la mutación, sin red.
 */
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}
if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false
}

function shift(overrides: Partial<ShiftListRow>): ShiftListRow {
  return {
    id: 'shift-1',
    clientId: 'client-1',
    clientName: 'Cliente Uno',
    siteId: 'site-1',
    siteName: 'Sede Uno',
    siteCity: null,
    shiftDate: '2026-09-27',
    startTime: '08:00:00',
    endTime: '16:00:00',
    requiredStaff: 2,
    status: 'scheduled',
    displayStatus: 'scheduled',
    assignedCount: 1,
    presentCount: 0,
    finishedCount: 0,
    absentCount: 0,
    delayedCount: 0,
    openEnded: false,
    noCheckoutCount: 0,
    generated: false,
    notes: null,
    ...overrides,
  }
}

const { assignSupervisionMock, toastError } = vi.hoisted(() => ({
  assignSupervisionMock: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: toastError },
}))

const shiftsData: { current: ShiftListRow[] } = { current: [] }
const leavesData: {
  current: { employeeId: string; startsOn: string; endsOn: string | null }[]
} = { current: [] }

vi.mock('@/features/employees/queries', () => ({
  useLeavesInRangeQuery: () => ({
    data: leavesData.current,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/features/shifts/queries', () => ({
  useShiftsByDateQuery: () => ({
    data: shiftsData.current,
    isLoading: false,
  }),
}))

vi.mock('@/features/supervisions/queries', () => ({
  useSupervisorCandidatesQuery: () => ({
    data: [{ profileId: 'sup-1', firstName: 'Marta', lastName: 'Ruiz' }],
    isLoading: false,
  }),
  useAssignSupervisionMutation: () => ({
    mutateAsync: assignSupervisionMock,
    isPending: false,
  }),
}))

function renderForm() {
  return render(
    <MemoryRouter>
      <AssignSupervisionForm onDone={() => {}} />
    </MemoryRouter>,
  )
}

describe('AssignSupervisionForm', () => {
  beforeEach(() => {
    leavesData.current = []
    assignSupervisionMock.mockReset()
  })

  it('el coordinador de licencia el día del turno figura deshabilitado «De licencia»', () => {
    shiftsData.current = [shift({ id: 'a', status: 'scheduled' })]
    leavesData.current = [
      { employeeId: 'sup-1', startsOn: '2000-01-01', endsOn: null },
    ]
    renderForm()
    fireEvent.click(screen.getByRole('combobox', { name: 'Coordinador' }))
    const option = screen.getByRole('option', { name: /Marta Ruiz/ })
    expect(option).toHaveTextContent('De licencia')
    expect(option).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(option, { key: 'Escape' })
  })

  it('si el servidor responde ON_LEAVE muestra su mensaje', async () => {
    shiftsData.current = [shift({ id: 'a', status: 'scheduled' })]
    assignSupervisionMock.mockRejectedValueOnce(
      new ApiError('El coordinador está de licencia ese día.', 'ON_LEAVE'),
    )
    renderForm()
    fireEvent.click(screen.getByRole('combobox', { name: 'Turno' }))
    fireEvent.click(screen.getByRole('option', { name: /Cliente Uno/ }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Coordinador' }))
    fireEvent.click(screen.getByRole('option', { name: 'Marta Ruiz' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Asignar supervisión',
        hidden: true,
      }),
    )
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'El coordinador está de licencia ese día.',
      ),
    )
  })

  it('el selector de turno solo ofrece los no cancelados ni completados', () => {
    shiftsData.current = [
      shift({ id: 'a', status: 'scheduled' }),
      shift({ id: 'b', status: 'cancelled' }),
      shift({ id: 'c', status: 'completed' }),
      shift({ id: 'd', status: 'in_progress' }),
    ]
    renderForm()
    fireEvent.click(screen.getByRole('combobox', { name: 'Turno' }))
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
  })

  it('sin turnos disponibles en la fecha, muestra el estado vacío', () => {
    shiftsData.current = [shift({ id: 'b', status: 'cancelled' })]
    renderForm()
    expect(
      screen.getByText('No hay turnos para supervisar en esta fecha'),
    ).toBeInTheDocument()
  })

  it('con la advertencia SUPERVISES_OWN_SHIFT, la muestra sin bloquear', async () => {
    shiftsData.current = [shift({ id: 'a', status: 'scheduled' })]
    assignSupervisionMock.mockResolvedValueOnce({
      supervision: { id: 'sup-x' },
      warnings: ['SUPERVISES_OWN_SHIFT'],
    })
    renderForm()

    fireEvent.click(screen.getByRole('combobox', { name: 'Turno' }))
    fireEvent.click(screen.getByRole('option', { name: /Cliente Uno/ }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Coordinador' }))
    fireEvent.click(screen.getByRole('option', { name: 'Marta Ruiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar supervisión' }))

    await vi.waitFor(() => {
      expect(
        screen.getByText(
          'Este coordinador también está asignado como empleado en este turno.',
        ),
      ).toBeInTheDocument()
    })
    // Ya quedó creada: no se puede volver a asignar, solo ir al detalle.
    expect(
      screen.queryByRole('button', { name: 'Asignar supervisión' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Ver supervisión' }),
    ).toBeInTheDocument()
  })
})
