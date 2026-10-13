import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import {
  EmployeeUpcomingShiftsTab,
  sortUpcomingAssignments,
} from './EmployeeUpcomingShiftsTab'

const { state } = vi.hoisted(() => ({
  state: { data: [] as unknown[], isLoading: false },
}))

vi.mock('@/features/planning/queries', () => ({
  useEmployeeUpcomingAssignmentsQuery: () => state,
}))

function row(over: Partial<AssignmentBoardRow>): AssignmentBoardRow {
  return {
    id: 'a1',
    shiftId: 's1',
    shiftDate: '2026-10-14',
    shiftStatus: 'assigned',
    employeeId: 'e1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Prueba',
    siteId: 'si1',
    siteName: 'Sede Central',
    clientName: 'Cliente Demo',
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    status: 'expected',
    notes: null,
    ...over,
  }
}

function renderTab() {
  return render(
    <MemoryRouter>
      <EmployeeUpcomingShiftsTab profileId="e1" />
    </MemoryRouter>,
  )
}

describe('EmployeeUpcomingShiftsTab (AJ3-04)', () => {
  beforeEach(() => {
    // Escritorio: DataTable decide tabla vs. RowCard con matchMedia.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  it('ordena por fecha y hora', () => {
    const sorted = sortUpcomingAssignments([
      row({ id: 'c', shiftDate: '2026-10-15', startTime: '07:00:00' }),
      row({ id: 'b', shiftDate: '2026-10-14', startTime: '14:00:00' }),
      row({ id: 'a', shiftDate: '2026-10-14', startTime: '08:00:00' }),
    ])
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('lista fecha, horario (con «A terminar»), cliente y sede, estado y enlace al turno', () => {
    state.data = [
      row({}),
      row({
        id: 'a2',
        shiftId: 's2',
        shiftDate: '2026-10-16',
        openEnded: true,
        endTime: '23:59:00',
        shiftStatus: 'cancelled',
      }),
    ]
    renderTab()
    expect(screen.getAllByText('Cliente Demo · Sede Central').length).toBe(2)
    expect(screen.getAllByText('08:00–12:00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('08:00–A terminar').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cancelado').length).toBeGreaterThan(0)
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toContain(
      '/admin/turnos/s1',
    )
  })

  it('muestra un estado vacío cuando no hay turnos', () => {
    state.data = []
    renderTab()
    expect(
      screen.getByText('No hay turnos próximos para mostrar'),
    ).toBeInTheDocument()
  })
})
