import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FixedGap } from '@/api/employeeFixed'
import { ApiError } from '@/api/errors'
import { buildCronogramaMonth } from '@/features/employees/cronograma'
import { CalendarioMonthEditor } from './CalendarioMonthEditor'

const { assign, toastApi } = vi.hoisted(() => ({
  assign: vi.fn(),
  toastApi: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: toastApi }))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [] }),
}))
vi.mock('@/features/employees/cronogramaCommands', () => ({
  runCronogramaCommand: vi.fn(),
}))
vi.mock('@/features/planning/queries', () => ({
  planningKeys: { all: ['planning'] },
  useAssignEmployeeMutation: () => ({ mutateAsync: assign }),
  useRemoveAssignmentMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAssignCandidatesQuery: () => ({ data: [] }),
  useShiftDetailQuery: () => ({
    isLoading: false,
    data: { assignments: [{ employeeId: 'otra-persona' }] },
  }),
}))
vi.mock('@/features/shifts/queries', () => ({
  shiftsKeys: { all: ['shifts'] },
}))
vi.mock('@/features/planning/components/AssignEmployeeSheet', () => ({
  WARNING_MESSAGES: {
    NOT_ENABLED_FOR_CLIENT: 'No habilitado para el cliente.',
    OUTSIDE_AVAILABILITY: 'Fuera de la disponibilidad.',
  },
  AssignEmployeeSheet: (props: {
    shiftId: string
    excludeEmployeeIds: string[]
  }) => (
    <div data-testid="asignar-sheet">
      {props.shiftId} excluye {props.excludeEmployeeIds.join(',')}
    </div>
  ),
}))

function gap(over: Partial<FixedGap> = {}): FixedGap {
  return {
    shiftId: 's1',
    shiftDate: '2026-11-10',
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    clientId: 'c1',
    clientName: 'Cliente',
    siteId: 'si1',
    siteName: 'Sede Central',
    serviceId: 'sv1',
    serviceName: 'Limpieza',
    calendarColor: 0,
    reason: 'NOT_ASSIGNED',
    detail: null,
    shiftStatus: 'scheduled',
    ...over,
  }
}

function renderEditor(
  gaps: FixedGap[],
  leaves: {
    id: string
    startsOn: string
    endsOn: string | null
    reason: string | null
    deletedAt: null
  }[] = [],
) {
  const month = buildCronogramaMonth({
    year: 2026,
    month: 11,
    assignments: [],
    leaves,
    holidays: [],
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CalendarioMonthEditor
          profileId="p1"
          personName="Ana Prueba"
          month={month}
          blocks={[]}
          allShifts={[]}
          canEdit
          gaps={gaps}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  assign.mockResolvedValue({ assignment: {}, warnings: [] })
})

describe('fijos sin asignar en el calendario (OH-06)', () => {
  it('dibuja el bloque con borde punteado, las tres casillas y el motivo', () => {
    renderEditor([gap({ reason: 'REMOVED' })])
    const cell = screen.getByTestId('dia-2026-11-10')
    const block = within(cell).getByTestId('hueco')
    expect(block.style.borderStyle).toBe('dashed')
    expect(block).toHaveTextContent('08:00')
    expect(block).toHaveTextContent('12:00')
    expect(block).toHaveTextContent('SEDE CENTRAL')
    expect(within(block).getByTestId('hueco-motivo')).toHaveTextContent(
      'Quitado a mano',
    )
    // No es un turno asignado: no se arrastra ni tiene el menú de un turno.
    expect(within(cell).queryByTestId('turno')).toBeNull()
  })

  it('DEF-P30-12: el bloque no desborda su celda: acciones apiladas, accesibles por nombre', () => {
    renderEditor([gap()])
    const block = screen.getByTestId('hueco')
    expect(block).toHaveClass('min-w-0', 'overflow-hidden')
    const reemplazar = within(block).getByRole('button', { name: /Reemplazar/ })
    const asignar = within(block).getByRole('button', { name: /Asignar/ })
    expect(reemplazar.parentElement).toHaveClass('flex-col')
    expect(reemplazar).toHaveClass('w-full', 'min-w-0')
    expect(asignar).toHaveClass('w-full', 'min-w-0')
  })

  it('sin huecos no dibuja nada', () => {
    renderEditor([])
    expect(screen.queryByTestId('hueco')).toBeNull()
  })

  it('en un día de licencia se ve el rótulo y, debajo, el bloque punteado', () => {
    renderEditor(
      [gap({ reason: 'ON_LEAVE' })],
      [
        {
          id: 'l1',
          startsOn: '2026-11-09',
          endsOn: '2026-11-12',
          reason: 'Vacaciones',
          deletedAt: null,
        },
      ],
    )
    const cell = screen.getByTestId('dia-2026-11-10')
    expect(cell).toHaveTextContent('VACACIONES')
    const block = within(cell).getByTestId('hueco')
    expect(block).toHaveTextContent('De licencia')
    // De licencia no se puede asignar a esta persona: solo reemplazar.
    expect(
      within(block).queryByRole('button', { name: /^Asignar a/ }),
    ).toBeNull()
    expect(
      within(block).getByRole('button', { name: /^Reemplazar/ }),
    ).toBeInTheDocument()
  })

  it('con superposición enlaza al turno del choque', () => {
    renderEditor([
      gap({
        reason: 'OVERLAP',
        detail: {
          conflictShiftId: 'sx',
          conflictAssignmentId: null,
          clientName: null,
          siteId: null,
          siteName: 'Sede Norte',
          serviceId: null,
          serviceName: null,
          shiftDate: '2026-11-10',
          startTime: '09:00:00',
          endTime: '11:00:00',
          openEnded: false,
          leaves: [],
          status: null,
          assigned: [],
        },
      }),
    ])
    const link = screen.getByRole('link', {
      name: 'Se superpone con Sede Norte 09:00–11:00',
    })
    expect(link).toHaveAttribute('href', '/admin/turnos/sx')
  })

  it('«Asignar» asigna a esta persona e informa el resultado', async () => {
    renderEditor([gap({ reason: 'ADDED_AFTER' })])
    fireEvent.click(screen.getByRole('button', { name: /^Asignar a Ana/ }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith({
        shiftId: 's1',
        employeeId: 'p1',
      }),
    )
    await waitFor(() => expect(toastApi.success).toHaveBeenCalled())
  })

  it('muestra el mensaje del servidor si rechaza la asignación', async () => {
    assign.mockRejectedValue(
      new ApiError('Ya tiene un turno en ese horario.', 'ASSIGNMENT_OVERLAP'),
    )
    renderEditor([gap()])
    fireEvent.click(screen.getByRole('button', { name: /^Asignar a Ana/ }))
    await waitFor(() => expect(toastApi.error).toHaveBeenCalled())
    expect(toastApi.error.mock.calls[0]?.[0]).toBe(
      'Ya tiene un turno en ese horario.',
    )
  })

  it('«Reemplazar» abre la asignación del turno sin ofrecer a esta persona ni a los ya asignados', () => {
    renderEditor([gap({ reason: 'ON_LEAVE' })])
    fireEvent.click(screen.getByRole('button', { name: /^Reemplazar/ }))
    expect(screen.getByTestId('asignar-sheet')).toHaveTextContent(
      's1 excluye p1,otra-persona',
    )
  })
})
