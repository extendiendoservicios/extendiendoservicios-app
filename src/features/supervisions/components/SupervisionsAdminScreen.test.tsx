import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupervisionListRow } from '@/api/supervisions'
import { makeAssignment } from '@/features/dashboard/fixtures'
import { SupervisionsAdminScreen } from './SupervisionsAdminScreen'

const { state, unsupervisedMock } = vi.hoisted(() => ({
  state: { rows: [] as unknown[], unsupervised: [] as unknown[] },
  unsupervisedMock: vi.fn(),
}))

vi.mock('@/features/supervisions/queries', () => ({
  useSupervisionsAdminQuery: () => ({
    isLoading: false,
    data: state.rows,
    dataUpdatedAt: 0,
  }),
  useRatingsQuery: () => ({ isLoading: false, data: [], dataUpdatedAt: 0 }),
  useUnsupervisedShiftsQuery: (...args: unknown[]) => {
    unsupervisedMock(...args)
    return { isLoading: false, data: state.unsupervised, dataUpdatedAt: 0 }
  },
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
    // Escritorio: ni la consulta de tarjetas (táctil, OF-17) ni nada más angosto.
    matches: !query.includes('pointer: coarse'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

function renderScreen(
  tab: 'supervisiones' | 'sin-supervisar' = 'supervisiones',
) {
  return render(
    <MemoryRouter>
      <SupervisionsAdminScreen tab={tab} onTabChange={() => {}} />
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

describe('SupervisionsAdminScreen: pestaña «Sin supervisar» (P35.2)', () => {
  const started = {
    checkInAt: '2026-11-20T08:02:00-03:00',
    displayStatus: 'present',
    status: 'present' as const,
    supervisionState: 'none' as const,
  }

  beforeEach(() => {
    unsupervisedMock.mockClear()
    state.rows = []
    state.unsupervised = [
      makeAssignment({ id: 'a1', shiftId: 's1', employeeId: 'e1', ...started }),
      makeAssignment({
        id: 'a2',
        shiftId: 's1',
        employeeId: 'e2',
        employeeFirstName: 'Beto',
        employeeLastName: 'Ruiz',
        ...started,
      }),
      makeAssignment({ id: 'a3', shiftId: 's2', supervisionState: 'none' }),
    ]
  })

  it('va entre «Calificaciones» y «Jornadas», con el contador de turnos', () => {
    renderScreen('sin-supervisar')
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual([
      'Supervisiones',
      'Calificaciones',
      'Sin supervisar (1)',
      'Jornadas',
    ])
  })

  it('una fila por turno con la píldora roja, el enlace al turno y la leyenda de 7 días', () => {
    renderScreen('sin-supervisar')
    expect(
      screen.getByText('Últimos 7 días. Elegí fechas para ver otro período.'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Sin supervisar')).toHaveLength(1)
    expect(screen.getByText('Sin supervisar')).toHaveClass('bg-danger-bg')
    const links = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href') === '/admin/turnos/s1')
    expect(links.length).toBeGreaterThan(0)
    expect(screen.getByText(/Ana Gómez, Beto Ruiz/)).toBeInTheDocument()
  })

  it('el filtro de coordinador queda deshabilitado', () => {
    renderScreen('sin-supervisar')
    expect(screen.getByLabelText('Filtrar por coordinador')).toBeDisabled()
    expect(screen.getByLabelText('Filtrar por empleado')).toBeEnabled()
  })

  it('sin turnos muestra el estado vacío', () => {
    state.unsupervised = []
    renderScreen('sin-supervisar')
    expect(
      screen.getByText('No hay turnos sin supervisar con estos filtros'),
    ).toBeInTheDocument()
  })

  it('consulta los últimos 7 días y solo pollea con la pestaña abierta', () => {
    renderScreen('sin-supervisar')
    const args = unsupervisedMock.mock.calls[0]!
    expect(args[4]).toBe(true)
    expect(args[3]).toBe(true)
    renderScreen('supervisiones')
    expect(unsupervisedMock.mock.calls.at(-1)![4]).toBe(false)
  })
})
