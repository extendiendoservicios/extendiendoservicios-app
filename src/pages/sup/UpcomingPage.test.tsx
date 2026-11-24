import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisorUpcomingPage from './UpcomingPage'
import type { MyDayAssignment } from '@/api/myDay'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as employeeQueriesModule from '@/features/employee/queries'

vi.mock('@/features/coordinator/components/UpcomingShiftsList', () => ({
  UpcomingShiftsList: () => <div data-testid="upcoming-list-stub" />,
}))

/** SUP-10 (D-09): la lista del coordinador y, si también es empleado, sus servicios de los próximos días. */
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
      shiftDate: '2026-10-25',
      isToday: false,
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

afterEach(() => {
  vi.restoreAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <SupervisorUpcomingPage />
    </MemoryRouter>,
  )
}

describe('SupervisorUpcomingPage (SUP-10)', () => {
  it('muestra la lista de próximos turnos y no ofrece servicios propios si no es empleado', () => {
    mockRoles(['supervisor'])
    renderPage()
    expect(screen.getByTestId('upcoming-list-stub')).toBeInTheDocument()
    expect(screen.queryByText('Tus servicios')).not.toBeInTheDocument()
  })

  it('a quien también es empleado le muestra arriba sus servicios de los próximos días, sin los de hoy', () => {
    mockRoles(['supervisor', 'employee'])
    mockMyDay([
      { assignmentId: 'hoy', isToday: true, siteName: 'Sede de hoy' },
      { assignmentId: 'prox', siteName: 'Sede de mañana' },
    ])
    renderPage()

    expect(screen.getByText('Tus servicios')).toBeInTheDocument()
    expect(screen.getByText(/Sede de mañana/)).toBeInTheDocument()
    expect(screen.queryByText(/Sede de hoy/)).not.toBeInTheDocument()
    const list = screen.getByTestId('upcoming-list-stub')
    expect(
      screen.getByText('Tus servicios').compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('un empleado sin próximos servicios no ve el bloque propio', () => {
    mockRoles(['supervisor', 'employee'])
    mockMyDay([{ assignmentId: 'hoy', isToday: true }])
    renderPage()
    expect(screen.queryByText('Tus servicios')).not.toBeInTheDocument()
  })
})
