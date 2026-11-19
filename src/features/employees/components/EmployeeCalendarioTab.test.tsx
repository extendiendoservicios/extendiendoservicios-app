import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CronogramaGrid } from './CronogramaGrid'
import { EmployeeCalendarioTab } from './EmployeeCalendarioTab'
import { clientChipColors } from '@/features/planning/clientColors'
import { buildCronogramaMonth } from '@/features/employees/cronograma'

const { state } = vi.hoisted(() => ({
  state: {
    assignments: [] as unknown[],
    leaves: [] as unknown[],
    holidays: [] as unknown[],
  },
}))

vi.mock('@/features/planning/queries', () => ({
  planningKeys: { all: ['planning'] },
  useShiftsBoardRangeQuery: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
  useAssignEmployeeMutation: () => ({ mutateAsync: vi.fn() }),
  useRemoveAssignmentMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAssignCandidatesQuery: () => ({ data: [] }),
  useEmployeeUpcomingAssignmentsQuery: () => ({
    data: state.assignments,
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('@/features/employees/queries', () => ({
  useEmployeeLeavesQuery: () => ({
    data: state.leaves,
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('@/features/settings/queries', () => ({
  useHolidaysQuery: () => ({
    data: state.holidays,
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [] }),
}))
vi.mock('@/features/shifts/queries', () => ({
  shiftsKeys: { all: ['shifts'] },
}))

const person = { employeeNumber: 17, name: 'Ana Prueba' }

function assignment(over: Partial<AssignmentBoardRow>): AssignmentBoardRow {
  return {
    id: 'a1',
    shiftId: 's1',
    shiftDate: '2026-11-03',
    shiftStatus: 'assigned',
    employeeId: 'e1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Prueba',
    siteId: 'si1',
    siteName: 'Sede Central',
    clientName: 'Cliente',
    clientId: 'c1',
    clientCalendarColor: 0,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    status: 'expected',
    notes: null,
    ...over,
  }
}

function gridFor(over: Parameters<typeof buildCronogramaMonth>[0]) {
  return <CronogramaGrid month={buildCronogramaMonth(over)} person={person} />
}

describe('CronogramaGrid (OD-01, OD-02)', () => {
  it('encabezado con mes, líneas de firma y «legajo NOMBRE», y cabecera de lunes a domingo', () => {
    render(
      gridFor({
        year: 2026,
        month: 11,
        assignments: [],
        leaves: [],
        holidays: [],
      }),
    )
    expect(screen.getByText('MES DE NOVIEMBRE 2026')).toBeInTheDocument()
    expect(screen.getByText(/FIRMA DE EMPLEADO:/)).toHaveTextContent(
      /ACLARACIÓN:.*DNI:/,
    )
    expect(screen.getByText('17 ANA PRUEBA')).toBeInTheDocument()
    expect(
      screen.getAllByRole('columnheader').map((header) => header.textContent),
    ).toEqual([
      'LUNES',
      'MARTES',
      'MIÉRCOLES',
      'JUEVES',
      'VIERNES',
      'SÁBADO',
      'DOMINGO',
    ])
    expect(screen.getAllByRole('row')).toHaveLength(1 + 6)
  })

  it('un turno muestra hora de inicio y fin y la sede en mayúsculas con el color del cliente', () => {
    render(
      gridFor({
        year: 2026,
        month: 11,
        assignments: [assignment({})],
        leaves: [],
        holidays: [],
      }),
    )
    const cell = screen.getByTestId('dia-2026-11-03')
    expect(within(cell).getByText('3')).toBeInTheDocument()
    expect(within(cell).getByText('08:00')).toBeInTheDocument()
    expect(within(cell).getByText('12:00')).toBeInTheDocument()
    const site = within(cell).getByTestId('sede')
    expect(site).toHaveTextContent('SEDE CENTRAL')
    // Fondo del chip del cliente 0 (P24.8).
    expect(site).toHaveStyle({
      backgroundColor: clientChipColors(0)!.background,
    })
  })

  it('licencia con motivo, licencia sin motivo, feriado y día vacío', () => {
    render(
      gridFor({
        year: 2026,
        month: 11,
        assignments: [],
        leaves: [
          {
            id: 'l1',
            startsOn: '2026-11-09',
            endsOn: '2026-11-09',
            reason: 'Franco',
            deletedAt: null,
          },
          {
            id: 'l2',
            startsOn: '2026-11-10',
            endsOn: '2026-11-10',
            reason: null,
            deletedAt: null,
          },
        ],
        holidays: [{ holidayDate: '2026-11-23', deletedAt: null }],
      }),
    )
    expect(screen.getByTestId('dia-2026-11-09')).toHaveTextContent('FRANCO')
    expect(screen.getByTestId('dia-2026-11-10')).toHaveTextContent('LICENCIA')
    const holiday = screen.getByTestId('dia-2026-11-23')
    expect(holiday).toHaveTextContent('FERIADO')
    expect(holiday).toHaveClass('bg-[#dc2626]')
    expect(screen.getByTestId('dia-2026-11-12')).toHaveAttribute(
      'data-kind',
      'empty',
    )
  })
})

function renderTab(
  props: Partial<React.ComponentProps<typeof EmployeeCalendarioTab>> = {},
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <EmployeeCalendarioTab profileId="p1" person={person} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EmployeeCalendarioTab (OD-03, OH-04, OH-05)', () => {
  beforeEach(() => {
    state.assignments = []
    state.leaves = []
    state.holidays = []
  })

  it('«Imprimir» abre la vista previa en A4 horizontal con la hoja de siempre', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryAllByTestId('cronograma')).toHaveLength(0)
    expect(screen.getByTestId('calendario-mes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))

    expect(screen.getByRole('dialog')).toHaveAttribute(
      'data-orientation',
      'landscape',
    )
    // La hoja impresa es la misma grilla de papel (firma, legajo), no la editable.
    expect(screen.getAllByTestId('cronograma')).toHaveLength(1)
    expect(screen.getByText(/FIRMA DE EMPLEADO:/)).toBeInTheDocument()
    expect(screen.getByText('17 ANA PRUEBA')).toBeInTheDocument()
  })

  it('no hay selector Mes/Semana: solo el selector de mes', () => {
    renderTab({ canEdit: true })
    expect(screen.queryByText('Semana (editar)')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Mes del calendario' }),
    ).toBeInTheDocument()
  })

  it('el mes sale de la dirección y un mes roto vuelve al actual', () => {
    renderTab({ monthParam: '2027-01', onMonthChange: vi.fn() })
    expect(screen.getByText('MES DE ENERO 2027')).toBeInTheDocument()
  })

  it('al cambiar de mes avisa con el valor para la dirección', () => {
    const onMonthChange = vi.fn()
    renderTab({ monthParam: '2026-11', onMonthChange })
    fireEvent.click(screen.getByRole('button', { name: 'Mes del calendario' }))
    fireEvent.click(screen.getByRole('button', { name: /^dic/i }))
    expect(onMonthChange).toHaveBeenCalledWith('2026-12')
  })

  it('sin permiso de edición el calendario es de solo lectura', () => {
    state.assignments = [assignment({})]
    renderTab({ monthParam: '2026-11', onMonthChange: vi.fn(), canEdit: false })
    expect(screen.queryByRole('button', { name: /Abrir el turno/ })).toBeNull()
    expect(screen.queryByLabelText(/Turnos sin cubrir/)).toBeNull()
    expect(screen.getByText('08:00')).toBeInTheDocument()
  })
})
