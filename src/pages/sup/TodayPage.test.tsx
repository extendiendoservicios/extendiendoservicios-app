import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisorTodayPage, { employeeNames } from './TodayPage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision } from '@/api/mySupervisions'

/**
 * SUP-02 (MOB-SUP-002): las supervisiones de hoy, el bloque "Próximos días"
 * y el estado vacío. Mismo patrón de mocks que el resto de la vía: se
 * reemplaza el hook de `@/api/mySupervisions` en vez de un
 * `QueryClientProvider` real.
 */
function supervision(overrides: Partial<MySupervision>): MySupervision {
  return {
    id: 'sv1',
    shiftId: 'sh1',
    shiftDate: '2026-09-27',
    isToday: true,
    clientId: 'c1',
    clientName: 'Limpiadora SRL',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteAddress: null,
    siteCity: null,
    siteLatitude: null,
    siteLongitude: null,
    siteContactName: null,
    siteContactPhone: null,
    accessInstructions: null,
    buildingHours: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    restrictionsNotes: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: null,
    endsAt: null,
    status: 'assigned',
    assignedAt: '2026-09-20T10:00:00Z',
    notDoneReason: null,
    cancelReason: null,
    generalNotes: null,
    criteriaSnapshot: null,
    checkInAt: null,
    checkOutAt: null,
    assignedEmployees: [
      {
        employeeId: 'e1',
        firstName: 'Ana',
        lastName: 'Gómez',
        status: 'expected',
        checkInAt: null,
      },
    ],
    ...overrides,
  }
}

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

describe('employeeNames', () => {
  it('junta nombre y apellido de cada empleado asignado, separados por coma', () => {
    expect(employeeNames(supervision({}))).toBe('Ana Gómez')
    expect(
      employeeNames(
        supervision({
          assignedEmployees: [
            {
              employeeId: 'e1',
              firstName: 'Ana',
              lastName: 'Gómez',
              status: 'expected',
              checkInAt: null,
            },
            {
              employeeId: 'e2',
              firstName: 'Luis',
              lastName: 'Paz',
              status: 'present',
              checkInAt: null,
            },
          ],
        }),
      ),
    ).toBe('Ana Gómez, Luis Paz')
  })
})

describe('SupervisorTodayPage (SUP-02)', () => {
  it('muestra el estado vacío cuando no hay supervisiones hoy', () => {
    vi.spyOn(
      mySupervisionsModule,
      'useMySupervisionsUpcomingQuery',
    ).mockReturnValue({ data: [], isLoading: false, isError: false } as never)

    renderToday()

    expect(screen.getByText('No tenés supervisiones hoy')).toBeInTheDocument()
  })

  it('lista las supervisiones de hoy con cliente, sede y empleados', () => {
    vi.spyOn(
      mySupervisionsModule,
      'useMySupervisionsUpcomingQuery',
    ).mockReturnValue({
      data: [supervision({})],
      isLoading: false,
      isError: false,
    } as never)

    renderToday()

    expect(screen.getByText('Limpiadora SRL')).toBeInTheDocument()
    expect(screen.getByText(/1 empleado · Ana Gómez/)).toBeInTheDocument()
  })

  it('muestra el bloque "Próximos días" con las supervisiones que no son de hoy', () => {
    vi.spyOn(
      mySupervisionsModule,
      'useMySupervisionsUpcomingQuery',
    ).mockReturnValue({
      data: [
        supervision({ id: 'sv2', isToday: false, shiftDate: '2026-09-28' }),
      ],
      isLoading: false,
      isError: false,
    } as never)

    renderToday()

    expect(screen.getByText('No tenés supervisiones hoy')).toBeInTheDocument()
    expect(screen.getByText('Próximos días')).toBeInTheDocument()
  })
})
