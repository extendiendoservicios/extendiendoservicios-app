import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShiftListRow } from '@/api/shifts'
import { ClientCalendarioTab } from './ClientCalendarioTab'

const { state, shiftsMock, assignmentsMock } = vi.hoisted(() => ({
  state: {
    shifts: [] as unknown[],
    assignments: [] as unknown[],
    holidays: [] as unknown[],
  },
  shiftsMock: vi.fn(),
  assignmentsMock: vi.fn(),
}))

// El mes de prueba es noviembre de 2026: «hoy» al principio para que cuenten sus sin cubrir.
vi.mock('@/features/employees/employeeLeaveStatus', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/features/employees/employeeLeaveStatus')
  >()),
  todayInBuenosAires: () => '2026-11-01',
}))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [] }),
}))
vi.mock('@/features/planning/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/planning/queries')>()),
  useShiftsBoardRangeQuery: (...args: unknown[]) => {
    shiftsMock(...args)
    return { data: state.shifts, isLoading: false, isError: false }
  },
  useAssignmentsBoardRangeQuery: (...args: unknown[]) => {
    assignmentsMock(...args)
    return { data: state.assignments, isLoading: false, isError: false }
  },
}))
vi.mock('@/features/clients/queries', () => ({
  useClientSitesQuery: () => ({
    data: [
      { id: 'site1', name: 'Sede Norte' },
      { id: 'site2', name: 'Sede Sur' },
    ],
  }),
}))
vi.mock('@/features/settings/queries', () => ({
  useHolidaysQuery: () => ({
    data: state.holidays,
    isLoading: false,
    isError: false,
  }),
}))

function shift(overrides: Partial<ShiftListRow> = {}): ShiftListRow {
  return {
    id: 's1',
    clientId: 'c1',
    clientName: 'Cliente',
    clientCalendarColor: 2,
    siteId: 'site1',
    siteName: 'Sede Norte',
    siteCity: null,
    shiftDate: '2026-11-10',
    startTime: '08:00:00',
    endTime: '12:00:00',
    requiredStaff: 1,
    status: 'scheduled',
    displayStatus: 'scheduled',
    openEnded: false,
    assignedCount: 0,
    presentCount: 0,
    finishedCount: 0,
    absentCount: 0,
    delayedCount: 0,
    noCheckoutCount: 0,
    generated: false,
    notes: null,
    ...overrides,
  }
}

const ANA = {
  id: 'a1',
  shiftId: 's1',
  employeeId: 'e1',
  employeeFirstName: 'Ana',
  employeeLastName: 'Pérez',
  startTime: '08:00:00',
  endTime: '12:00:00',
}

function Search() {
  return <p data-testid="search">{useLocation().search}</p>
}

function renderTab(search = '?mes=2026-11') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/admin/clientes/c1${search}`]}>
        <ClientCalendarioTab clientId="c1" clientName="Limpieza SA" />
        <Search />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ClientCalendarioTab', () => {
  beforeEach(() => {
    state.shifts = [shift()]
    state.assignments = [ANA]
    state.holidays = []
    shiftsMock.mockClear()
    assignmentsMock.mockClear()
  })

  it('pide los turnos y las asignaciones vigentes del cliente en el mes', () => {
    renderTab()
    expect(shiftsMock).toHaveBeenCalledWith('2026-11-01', '2026-11-30', {
      clientId: 'c1',
      siteId: undefined,
      employeeId: undefined,
    })
    expect(assignmentsMock).toHaveBeenCalledWith('2026-11-01', '2026-11-30', {
      clientId: 'c1',
      siteId: undefined,
      onlyActive: true,
    })
  })

  it('muestra horas, sede que abre el turno y quién va', () => {
    renderTab()
    const day = screen.getByTestId('dia-2026-11-10')
    expect(within(day).getByText('08:00')).toBeTruthy()
    expect(within(day).getByText('12:00')).toBeTruthy()
    const link = within(day).getByRole('link', {
      name: 'Abrir el turno de Sede Norte',
    })
    expect(link.getAttribute('href')).toBe('/admin/turnos/s1')
    expect(within(day).getByText('Ana Pérez')).toBeTruthy()
  })

  it('muestra «Faltan N» cuando hay gente pero falta dotación', () => {
    state.shifts = [shift({ requiredStaff: 3 })]
    renderTab()
    expect(screen.getByText('Faltan 2')).toBeTruthy()
  })

  it('un turno sin nadie dice «Sin cubrir» y la línea del mes lo resalta', () => {
    state.assignments = []
    renderTab()
    const day = screen.getByTestId('dia-2026-11-10')
    expect(within(day).getByText('Sin cubrir')).toBeTruthy()
    const turno = within(day).getByTestId('turno')
    expect(turno.dataset.highlighted).toBeUndefined()
    fireEvent.click(screen.getByText('1 turno sin cubrir este mes'))
    expect(turno.dataset.highlighted).toBe('true')
  })

  it('no muestra la línea de sin cubrir si todo está cubierto', () => {
    renderTab()
    expect(screen.queryByText(/sin cubrir este mes/)).toBeNull()
  })

  it('un turno a terminar muestra el fin con guion', () => {
    state.shifts = [shift({ openEnded: true, endTime: '23:59:00' })]
    renderTab()
    expect(
      within(screen.getByTestId('dia-2026-11-10')).getByText('—'),
    ).toBeTruthy()
  })

  it('el feriado lleva su nombre en la cabecera del día', () => {
    state.holidays = [
      { holidayDate: '2026-11-23', name: 'Soberanía', deletedAt: null },
    ]
    renderTab()
    expect(
      within(screen.getByTestId('dia-2026-11-23')).getByTestId('feriado')
        .textContent,
    ).toBe('Soberanía')
  })

  it('muestra 4 turnos y «+N más» despliega y «Ver menos» recoge', () => {
    state.shifts = Array.from({ length: 6 }, (_, i) =>
      shift({ id: `s${i}`, startTime: `0${i + 1}:00:00` }),
    )
    state.assignments = []
    renderTab()
    const day = screen.getByTestId('dia-2026-11-10')
    expect(within(day).getAllByTestId('turno')).toHaveLength(4)
    fireEvent.click(within(day).getByText('+2 más'))
    expect(within(day).getAllByTestId('turno')).toHaveLength(6)
    fireEvent.click(within(day).getByText('Ver menos'))
    expect(within(day).getAllByTestId('turno')).toHaveLength(4)
  })

  it('los filtros viven en la dirección y se pasan a las consultas', () => {
    renderTab()
    fireEvent.change(screen.getByLabelText('Sede'), {
      target: { value: 'site2' },
    })
    fireEvent.change(screen.getByLabelText('Empleado'), {
      target: { value: 'e1' },
    })
    const search = screen.getByTestId('search').textContent ?? ''
    expect(search).toContain('sede=site2')
    expect(search).toContain('empleado=e1')
    expect(search).toContain('mes=2026-11')
    expect(shiftsMock).toHaveBeenLastCalledWith('2026-11-01', '2026-11-30', {
      clientId: 'c1',
      siteId: 'site2',
      employeeId: 'e1',
    })
  })

  it('lista en el filtro de empleado a quienes tienen asignaciones', () => {
    renderTab()
    const select = screen.getByLabelText('Empleado')
    expect(within(select).getByText('Pérez, Ana')).toBeTruthy()
    expect(within(select).getByText('Todos los empleados')).toBeTruthy()
  })

  it('en solo lectura las horas no son editables', () => {
    renderTab()
    expect(screen.queryByRole('button', { name: /Hora de inicio/ })).toBeNull()
  })
})
