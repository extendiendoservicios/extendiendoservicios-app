import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SupervisorUpcomingPage from './UpcomingPage'
import type { MyDayAssignment } from '@/api/myDay'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as employeeQueriesModule from '@/features/employee/queries'
import * as todayModule from '@/api/supervisorToday'
import { makeTodayShift } from '@/features/coordinator/fixtures'

/**
 * SUP-10 (P32, D-05 y D-06): minicalendario (abre en mañana) y, debajo, los
 * turnos del día elegido; si es empleado, «Tus servicios» de ese día arriba.
 * Hoy simulado: 24/11/2026 (mañana = 25/11).
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

const shiftsSpy = () => vi.spyOn(todayModule, 'useSupervisorShiftsMonthQuery')

function mockShifts(data: ReturnType<typeof makeTodayShift>[]) {
  return shiftsSpy().mockReturnValue({
    data,
    isLoading: false,
    isError: false,
  } as never)
}

function mockServices(assignments: Partial<MyDayAssignment>[]) {
  return vi
    .spyOn(employeeQueriesModule, 'useMyServicesMonthQuery')
    .mockReturnValue({
      data: assignments.map((overrides) => ({
        assignmentId: 'a1',
        shiftId: 'sh9',
        shiftDate: '2026-11-25',
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
      isLoading: false,
      isError: false,
    } as never)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-24T15:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderPage() {
  // Los hooks de consulta se llaman siempre (el de servicios propios, deshabilitado si no es empleado).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SupervisorUpcomingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SupervisorUpcomingPage (SUP-10)', () => {
  it('abre en mañana, pide el mes visible y muestra los turnos de ese día', () => {
    mockRoles(['supervisor'])
    const spy = mockShifts([
      makeTodayShift({
        shiftId: 'a',
        shiftDate: '2026-11-25',
        siteName: 'Torre Norte',
      }),
      makeTodayShift({
        shiftId: 'b',
        shiftDate: '2026-11-26',
        siteName: 'Local Centro',
      }),
    ])
    renderPage()

    expect(spy).toHaveBeenCalledWith('2026-11', '2026-11-01', '2026-11-30')
    expect(
      screen.getByRole('button', {
        name: 'miércoles 25 de noviembre de 2026, con servicios',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Torre Norte')).toBeInTheDocument()
    expect(screen.queryByText('Local Centro')).not.toBeInTheDocument()
    expect(screen.queryByText('Tus servicios')).not.toBeInTheDocument()
  })

  it('al elegir otro día cambia el detalle; un día sin turnos dice «No hay turnos el …»', () => {
    mockRoles(['supervisor'])
    mockShifts([
      makeTodayShift({
        shiftId: 'b',
        shiftDate: '2026-11-26',
        siteName: 'Local Centro',
      }),
    ])
    renderPage()

    expect(
      screen.getByText('No hay turnos el miércoles 25 de noviembre'),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'jueves 26 de noviembre de 2026, con servicios',
      }),
    )
    expect(screen.getByText('Local Centro')).toBeInTheDocument()
  })

  it('a quien también es empleado le muestra arriba «Tus servicios» del día elegido', () => {
    mockRoles(['supervisor', 'employee'])
    mockShifts([
      makeTodayShift({
        shiftId: 'a',
        shiftDate: '2026-11-25',
        siteName: 'Torre Norte',
      }),
    ])
    mockServices([
      { assignmentId: 'prox', siteName: 'Sede de mañana' },
      {
        assignmentId: 'otro',
        shiftDate: '2026-11-27',
        siteName: 'Sede de otro día',
      },
    ])
    renderPage()

    expect(screen.getByText('Tus servicios')).toBeInTheDocument()
    expect(screen.getByText(/Sede de mañana/)).toBeInTheDocument()
    expect(screen.queryByText(/Sede de otro día/)).not.toBeInTheDocument()
    expect(
      screen
        .getByText('Tus servicios')
        .compareDocumentPosition(screen.getByText('Torre Norte')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('un empleado sin servicios ese día no ve el bloque propio', () => {
    mockRoles(['supervisor', 'employee'])
    mockShifts([])
    mockServices([])
    renderPage()
    expect(screen.queryByText('Tus servicios')).not.toBeInTheDocument()
  })
})
