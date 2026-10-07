import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/api/users'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import { at, makeAssignment } from '@/features/dashboard/fixtures'
import { EmployeeAttendanceHistoryTab } from './EmployeeAttendanceHistoryTab'

const { historyMock, supervisionsMock } = vi.hoisted(() => ({
  historyMock: vi.fn(),
  supervisionsMock: vi.fn(),
}))

vi.mock('@/features/attendance/queries', () => ({
  useEmployeeAttendanceHistoryQuery: historyMock,
}))

vi.mock('@/features/supervisions/queries', () => ({
  useSupervisionsAdminQuery: supervisionsMock,
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
  supervisionsMock.mockReset().mockReturnValue({ data: [], isLoading: false })
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

  it('un supervisor suma sus supervisiones y muestra la columna «Tipo»', () => {
    supervisionsMock.mockReturnValue({
      data: [
        {
          id: 'sup1',
          shiftId: 's9',
          shiftDate: '2026-10-04',
          clientName: 'Cliente Uno',
          siteName: 'Sede Uno',
          startTime: '09:00:00',
          endTime: '10:00:00',
          status: 'completed',
          checkInAt: at('09:00'),
          checkOutAt: at('10:00'),
          generalNotes: null,
          plannedMinutes: 60,
          workedMinutes: 60,
        },
      ],
      isLoading: false,
    })
    renderTab(['owner'], ['employee', 'supervisor'])

    expect(
      screen.getByLabelText('Total de horas del período'),
    ).toHaveTextContent('8 h 30 min')
    expect(
      screen.getByRole('columnheader', { name: 'Tipo' }),
    ).toBeInTheDocument()
    expect(supervisionsMock).toHaveBeenCalledWith(
      { supervisorId: 'e1', dateFrom: '2026-09-07', dateTo: '2026-10-07' },
      false,
      true,
    )
  })
})
