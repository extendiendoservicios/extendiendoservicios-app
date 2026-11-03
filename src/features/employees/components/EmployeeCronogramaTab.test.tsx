import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import { CronogramaGrid, EmployeeCronogramaTab } from './EmployeeCronogramaTab'
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

describe('EmployeeCronogramaTab (OD-03)', () => {
  beforeEach(() => {
    state.assignments = []
    state.leaves = []
    state.holidays = []
  })

  it('«Imprimir» abre la vista previa en A4 horizontal con la misma grilla', () => {
    render(<EmployeeCronogramaTab profileId="p1" person={person} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByTestId('cronograma')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))

    expect(screen.getByRole('dialog')).toHaveAttribute(
      'data-orientation',
      'landscape',
    )
    expect(screen.getAllByTestId('cronograma')).toHaveLength(2)
  })
})
