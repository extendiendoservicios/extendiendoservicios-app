import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupervisionListRow } from '@/api/supervisions'
import { SupervisionsAdminScreen } from './SupervisionsAdminScreen'

const { state } = vi.hoisted(() => ({
  state: { rows: [] as unknown[] },
}))

vi.mock('@/features/supervisions/queries', () => ({
  useSupervisionsAdminQuery: () => ({
    isLoading: false,
    data: state.rows,
    dataUpdatedAt: 0,
  }),
  useRatingsQuery: () => ({ isLoading: false, data: [], dataUpdatedAt: 0 }),
}))
vi.mock('@/features/employees/queries', () => ({
  useEmployeesQuery: () => ({ data: [] }),
}))

function row(overrides: Partial<SupervisionListRow>): SupervisionListRow {
  return {
    id: 'sup1',
    shiftId: 'sh1',
    shiftDate: '2026-10-22',
    clientId: 'c1',
    clientName: 'Limpiadora SRL',
    siteId: 'si1',
    siteName: 'Sede Centro',
    startTime: '08:00:00',
    endTime: '12:00:00',
    shiftOpenEnded: false,
    supervisorId: 'e1',
    supervisorFirstName: 'Ana',
    supervisorLastName: 'Pérez',
    status: 'completed',
    assignedAt: '2026-10-22T11:00:00Z',
    checkInAt: '2026-10-22T11:10:00Z',
    checkOutAt: '2026-10-22T12:40:00Z',
    generalNotes: null,
    cancelReason: null,
    notDoneReason: null,
    criteriaSnapshot: [],
    ratingsCount: 2,
    ratingsAvg: 4,
    assignedEmployeesCount: 2,
    plannedMinutes: 240,
    workedMinutes: 90,
    durationMinutes: 90,
    unclosed: false,
    workdayAutoClosed: false,
    workdayId: 'wd1',
    ...overrides,
  }
}

beforeEach(() => {
  // Escritorio: `DataTable` decide tabla o tarjetas con `useMediaQuery`.
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

function renderScreen() {
  return render(
    <MemoryRouter>
      <SupervisionsAdminScreen tab="supervisiones" onTabChange={() => {}} />
    </MemoryRouter>,
  )
}

describe('SupervisionsAdminScreen (ADM-13, coordinación libre)', () => {
  it('no ofrece «Asignar supervisión» ni el filtro por estado', () => {
    state.rows = [row({})]
    renderScreen()
    expect(screen.queryByText(/Asignar supervisión/)).toBeNull()
    expect(screen.queryByRole('link', { name: /Asignar/ })).toBeNull()
    expect(screen.queryByLabelText('Filtrar por estado')).toBeNull()
    expect(screen.getByLabelText('Filtrar por coordinador')).toBeVisible()
  })

  it('lista dos supervisiones del mismo turno, una por coordinador, con su duración informativa', () => {
    state.rows = [
      row({}),
      row({
        id: 'sup2',
        supervisorId: 'e2',
        supervisorFirstName: 'Bruno',
        supervisorLastName: 'Gómez',
        durationMinutes: 45,
      }),
    ]
    renderScreen()
    expect(
      screen.getAllByText('Limpiadora SRL', { exact: false }),
    ).toHaveLength(2)
    expect(screen.getAllByText('Ana Pérez').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bruno Gómez').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1 h 30 min').length).toBeGreaterThan(0)
    expect(screen.getAllByText('45 min').length).toBeGreaterThan(0)
  })

  it('marca «Sin cerrar» la que dejó abierta el cierre automático (CJ-31)', () => {
    state.rows = [
      row({ id: 'sup3', status: 'in_progress', unclosed: true }),
      row({ id: 'sup4', status: 'in_progress', unclosed: false }),
    ]
    renderScreen()
    const unclosed = screen.getAllByText('Sin cerrar')
    // Una por la tabla de escritorio y otra por la tarjeta responsive, a lo sumo.
    expect(unclosed.length).toBeGreaterThan(0)
    const first = unclosed[0]!.closest('tr, li, article, div')!
    expect(within(first as HTMLElement).getAllByText('En curso').length).toBe(1)
  })
})
