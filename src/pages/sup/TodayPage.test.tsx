import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SupervisorTodayPage from './TodayPage'
import type { MyDayAssignment } from '@/api/myDay'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as employeeQueriesModule from '@/features/employee/queries'

// Los anuncios, la barra de jornada y la lista de turnos tienen sus propios
// tests; acá se reemplazan por marcadores.
vi.mock('@/features/announcements/mobile/AnnouncementsBanner', () => ({
  AnnouncementsBanner: () => null,
}))
vi.mock('@/features/coordinator/components/WorkdayBar', () => ({
  WorkdayBar: () => <div data-testid="workday-bar-stub" />,
}))
vi.mock('@/features/coordinator/components/TodayShiftsList', () => ({
  TodayShiftsList: () => <div data-testid="shifts-list-stub" />,
}))

/**
 * SUP-02 (P24.2): la barra de jornada arriba y la lista de turnos del día
 * abajo; quien además es empleado ve antes sus propios servicios (P19.9).
 */
function mockRoles(roles: AuthContextValue['roles']) {
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    status: 'authenticated',
    userId: 'user-1',
    email: 'marta.rios@extendiendoservicios.com',
    roles,
    capabilities: [],
    profile: null,
    displayName: 'Marta Ríos',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
  })
}

function mockMyDay(assignments: Partial<MyDayAssignment>[]) {
  vi.spyOn(employeeQueriesModule, 'useMyDayQuery').mockReturnValue({
    data: assignments.map((overrides) => ({
      assignmentId: 'a1',
      shiftId: 'sh9',
      shiftDate: '2026-09-27',
      isToday: true,
      clientName: 'Oficinas Norte',
      siteName: 'Sede Norte',
      siteAddress: null,
      startTime: '14:00:00',
      endTime: '18:00:00',
      openEnded: false,
      noCheckout: false,
      status: 'expected',
      shiftStatus: 'assigned',
      checkInAt: null,
      checkOutAt: null,
      lastNoticeKind: null,
      ...overrides,
    })),
    isError: false,
  } as never)
}

beforeEach(() => {
  mockRoles(['supervisor'])
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderToday() {
  return render(
    <MemoryRouter>
      <SupervisorTodayPage />
    </MemoryRouter>,
  )
}

describe('SupervisorTodayPage (SUP-02)', () => {
  it('muestra la barra de jornada arriba y la lista de turnos abajo', () => {
    renderToday()

    const bar = screen.getByTestId('workday-bar-stub')
    const list = screen.getByTestId('shifts-list-stub')
    expect(
      bar.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('ya no muestra supervisiones asignadas ni «Próximos días»', () => {
    renderToday()

    expect(screen.queryByText('Próximos días')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/No tenés supervisiones hoy/),
    ).not.toBeInTheDocument()
  })

  it('a quien también es empleado le muestra sus propios servicios de hoy (P19.9)', () => {
    mockRoles(['supervisor', 'employee'])
    mockMyDay([{}, { assignmentId: 'a2', isToday: false }])

    renderToday()

    expect(screen.getByText('Tus servicios de hoy')).toBeInTheDocument()
    expect(screen.getByText('Oficinas Norte')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Oficinas Norte/ }),
    ).toHaveAttribute('href', '/app/servicio/a1')
  })

  it('a quien es solo supervisor no le muestra el bloque de servicios', () => {
    const myDaySpy = vi.spyOn(employeeQueriesModule, 'useMyDayQuery')

    renderToday()

    expect(screen.queryByText('Tus servicios de hoy')).not.toBeInTheDocument()
    expect(myDaySpy).not.toHaveBeenCalled()
  })
})
