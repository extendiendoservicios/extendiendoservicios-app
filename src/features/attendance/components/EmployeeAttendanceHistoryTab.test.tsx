import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/api/users'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import { at, makeAssignment } from '@/features/dashboard/fixtures'
import {
  makeWorkday,
  makeWorkdaySupervision,
} from '@/features/geo/coordinatorFixtures'
import { EmployeeAttendanceHistoryTab } from './EmployeeAttendanceHistoryTab'

const { historyMock, workdaysMock } = vi.hoisted(() => ({
  historyMock: vi.fn(),
  workdaysMock: vi.fn(),
}))

vi.mock('@/features/attendance/queries', () => ({
  useEmployeeAttendanceHistoryQuery: historyMock,
}))

vi.mock('@/features/workdays/queries', () => ({
  useSupervisorWorkdaysQuery: workdaysMock,
}))

vi.mock('@/features/employees/queries', () => ({
  useEmployeeLeavesQuery: () => ({ data: [], isLoading: false }),
}))

vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-10-07',
}))

function authAs(roles: Role[]): AuthContextValue {
  return {
    status: 'authenticated',
    userId: 'u1',
    email: 'x@example.com',
    roles,
    capabilities: [],
    profile: null,
    displayName: 'Admin',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }
}

const rows = [
  makeAssignment({
    id: 'a1',
    shiftDate: '2026-10-05',
    checkInAt: at('08:00'),
    checkOutAt: at('12:00'),
    workedMinutes: 240,
  }),
  makeAssignment({
    id: 'a2',
    shiftDate: '2026-10-06',
    checkInAt: at('08:00'),
    checkOutAt: at('11:30'),
    workedMinutes: 210,
    minutesEarlyLeave: 30,
  }),
]

function renderTab(roles: Role[], personRoles: Role[] = ['employee']) {
  vi.spyOn(authModule, 'useAuth').mockReturnValue(authAs(roles))
  render(
    <MemoryRouter>
      <EmployeeAttendanceHistoryTab
        profileId="e1"
        person={{
          name: 'Carlos Medina',
          employeeNumber: 19,
          roles: personRoles,
        }}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  historyMock.mockReset().mockReturnValue({ data: rows, isLoading: false })
  workdaysMock.mockReset().mockReturnValue({ data: [], isLoading: false })
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

describe('EmployeeAttendanceHistoryTab (AJ-06)', () => {
  it('muestra el total de horas del período y la columna de horas trabajadas', () => {
    renderTab(['admin'])

    expect(
      screen.getByLabelText('Total de horas del período'),
    ).toHaveTextContent('7 h 30 min')
    expect(
      screen.getByRole('columnheader', { name: 'Horas trabajadas' }),
    ).toBeInTheDocument()
    // Desde: 30 días antes de hoy.
    expect(historyMock).toHaveBeenCalledWith('e1', '2026-09-07', '2026-10-07')
  })

  it('«Descargar detalle» es solo del dueño y los administradores', () => {
    renderTab(['supervisor'])
    expect(
      screen.queryByRole('button', { name: 'Descargar detalle' }),
    ).not.toBeInTheDocument()
  })

  it('un administrador ve «Descargar detalle»', () => {
    renderTab(['admin'])
    expect(
      screen.getByRole('button', { name: 'Descargar detalle' }),
    ).toBeEnabled()
  })

  it('las horas del coordinador son las de su jornada: las supervisiones no suman (CJ-14)', () => {
    workdaysMock.mockReturnValue({
      data: [
        makeWorkday({
          workedMinutes: 480,
          supervisions: [makeWorkdaySupervision({ durationMinutes: 300 })],
        }),
      ],
      isLoading: false,
    })
    renderTab(['owner'], ['employee', 'supervisor'])

    // 7 h 30 min de turnos como empleado + 8 h de jornada.
    expect(
      screen.getByLabelText('Total de horas del período'),
    ).toHaveTextContent('15 h 30 min')
    expect(
      screen.getByLabelText('Total de horas del período'),
    ).toHaveTextContent('Como empleado 7 h 30 min')
    expect(
      screen.getByLabelText('Total de horas del período'),
    ).toHaveTextContent('Como coordinador (jornadas) 8 h')
    // Ya no hay columna «Tipo»: la tabla lista solo los turnos como empleado.
    expect(
      screen.queryByRole('columnheader', { name: 'Tipo' }),
    ).not.toBeInTheDocument()
    expect(workdaysMock).toHaveBeenCalledWith(
      { supervisorId: 'e1', dateFrom: '2026-09-07', dateTo: '2026-10-07' },
      true,
    )
  })

  it('un empleado común no consulta jornadas', () => {
    renderTab(['admin'])
    expect(workdaysMock).toHaveBeenCalledWith(
      { supervisorId: 'e1', dateFrom: '2026-09-07', dateTo: '2026-10-07' },
      false,
    )
  })
})
