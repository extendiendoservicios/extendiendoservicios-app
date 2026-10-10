import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisionDetailPage from './SupervisionDetailPage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision } from '@/api/mySupervisions'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'

/**
 * SUP-03 (MOB-SUP-004, MOB-SUP-006, MOB-SUP-007): sede, franja, empleados
 * con su estado de asistencia e inicio real, tareas en solo lectura y la
 * guía de criterios. El botón "Registrar inicio de supervisión" aparece con
 * la supervisión asignada o en curso, y no con una ya cerrada. "Cerrar
 * supervisión" (P15.5) aparece mientras la supervisión esté abierta, sin
 * importar si ya se registraron inicio y fin. Por empleado, "Calificar"
 * (P15.5) no se ofrece para el propio supervisor (CB-13) ni fuera del plazo
 * de P-083 (MOB-SUP-011). Mismo patrón de mocks que
 * `SupervisionAttendancePage.test.tsx`: se reemplazan los hooks del módulo
 * de datos y `useAuth` en vez de un `QueryClientProvider`/`AuthProvider`
 * reales.
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
    siteAddress: 'Av. Siempre Viva 123',
    siteCity: 'San Isidro',
    siteLatitude: -34.47,
    siteLongitude: -58.5,
    siteContactName: 'Marcela',
    siteContactPhone: '1122334455',
    accessInstructions: null,
    buildingHours: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    restrictionsNotes: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: null,
    // Lejos en el futuro a propósito (P-083: la ventana de edición depende
    // de la hora real, no puede depender del reloj de la máquina que corre
    // el test) -- el único test que verifica la ventana cerrada la pisa con
    // una fecha bien pasada.
    endsAt: '2030-01-01T12:00:00Z',
    shiftOpenEnded: false,
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
        status: 'present',
        checkInAt: '2026-09-27T11:05:00Z',
      },
    ],
    ...overrides,
  }
}

function authValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    status: 'authenticated',
    userId: 'sup-1',
    email: 'marta.rios@extendiendoservicios.com',
    roles: ['supervisor'],
    capabilities: [],
    profile: null,
    displayName: 'Marta Ríos',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderDetail(id = 'sv1') {
  return render(
    <MemoryRouter initialEntries={[`/sup/supervisiones/${id}`]}>
      <Routes>
        <Route
          path="/sup/supervisiones/:id"
          element={<SupervisionDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

/** Mockea los hooks comunes a todos los tests, con valores neutros (P15.5: assignments/ratings/auth). */
function mockCommon() {
  vi.spyOn(
    mySupervisionsModule,
    'useSupervisionShiftTasksQuery',
  ).mockReturnValue({
    data: [],
  } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useVigentRatingCriteriaQuery',
  ).mockReturnValue({
    data: [],
  } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useSupervisionAssignmentsQuery',
  ).mockReturnValue({
    data: [{ assignmentId: 'a1', employeeId: 'e1' }],
  } as never)
  vi.spyOn(mySupervisionsModule, 'useSupervisionRatingsQuery').mockReturnValue({
    data: [],
  } as never)
  vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SupervisionDetailPage (SUP-03)', () => {
  it('muestra el cliente, la sede, la franja y los empleados con su estado e inicio real', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)

    renderDetail()

    expect(screen.getByText('Limpiadora SRL')).toBeInTheDocument()
    expect(screen.getByText('Sede Centro')).toBeInTheDocument()
    expect(screen.getByText('08:00–12:00')).toBeInTheDocument()
    expect(screen.getAllByText('Ana Gómez').length).toBeGreaterThan(0)
    expect(screen.getByText('Inicio: 08:05')).toBeInTheDocument()
  })

  it('ofrece "Registrar inicio de supervisión" cuando está asignada o en curso', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({ status: 'assigned' }),
      isLoading: false,
      isError: false,
    } as never)

    renderDetail()

    const link = screen
      .getByText('Registrar inicio de supervisión')
      .closest('a')
    expect(link).toHaveAttribute('href', '/sup/supervisiones/sv1/registro')
  })

  it('con inicio y sin fin ofrece "Registrar fin"; con los dos, "Cerrar supervisión"', () => {
    mockCommon()
    const query = vi
      .spyOn(mySupervisionsModule, 'useMySupervisionQuery')
      .mockReturnValue({
        data: supervision({
          status: 'in_progress',
          checkInAt: '2026-09-27T11:05:00Z',
        }),
        isLoading: false,
        isError: false,
      } as never)

    const { unmount } = renderDetail()
    expect(screen.getByText('Registrar fin de supervisión')).toBeInTheDocument()
    expect(
      screen.queryByText('Registrar inicio de supervisión'),
    ).not.toBeInTheDocument()
    unmount()

    query.mockReturnValue({
      data: supervision({
        status: 'in_progress',
        checkInAt: '2026-09-27T11:05:00Z',
        checkOutAt: '2026-09-27T12:00:00Z',
      }),
      isLoading: false,
      isError: false,
    } as never)
    renderDetail()
    expect(screen.queryByText(/Registrar (inicio|fin)/)).not.toBeInTheDocument()
    expect(screen.getByText(/Finalizada a las/)).toBeInTheDocument()
    const closeLink = screen.getByText('Cerrar supervisión').closest('a')
    expect(closeLink).toHaveAttribute('href', '/sup/supervisiones/sv1/cerrar')
  })

  it('no ofrece ningún registro ni cierre cuando la supervisión ya está completada', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({ status: 'completed' }),
      isLoading: false,
      isError: false,
    } as never)

    renderDetail()

    expect(
      screen.queryByText('Registrar inicio de supervisión'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Cerrar supervisión')).not.toBeInTheDocument()
  })

  it('muestra los criterios vigentes como guía desplegable', () => {
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionShiftTasksQuery',
    ).mockReturnValue({
      data: [],
    } as never)
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionAssignmentsQuery',
    ).mockReturnValue({
      data: [{ assignmentId: 'a1', employeeId: 'e1' }],
    } as never)
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionRatingsQuery',
    ).mockReturnValue({
      data: [],
    } as never)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(
      mySupervisionsModule,
      'useVigentRatingCriteriaQuery',
    ).mockReturnValue({
      data: [
        {
          id: 'cr1',
          title: 'Orden',
          description: 'Todo en su lugar',
          position: 1,
        },
      ],
    } as never)

    renderDetail()

    expect(screen.getByText('Orden')).toBeInTheDocument()
    expect(screen.getByText('Todo en su lugar')).toBeInTheDocument()
  })

  it('ofrece "Calificar" para un empleado del turno cuando la supervisión está en curso', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({
        status: 'in_progress',
        checkInAt: '2026-09-27T11:05:00Z',
      }),
      isLoading: false,
      isError: false,
    } as never)

    renderDetail()

    const link = screen.getByText('Calificar').closest('a')
    expect(link).toHaveAttribute('href', '/sup/supervisiones/sv1/calificar/a1')
  })

  it('CB-13: no ofrece calificarse a sí mismo cuando el supervisor también es empleado del turno', () => {
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionShiftTasksQuery',
    ).mockReturnValue({
      data: [],
    } as never)
    vi.spyOn(
      mySupervisionsModule,
      'useVigentRatingCriteriaQuery',
    ).mockReturnValue({
      data: [],
    } as never)
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionAssignmentsQuery',
    ).mockReturnValue({
      data: [{ assignmentId: 'a1', employeeId: 'sup-1' }],
    } as never)
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionRatingsQuery',
    ).mockReturnValue({
      data: [],
    } as never)
    vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({
        status: 'in_progress',
        checkInAt: '2026-09-27T11:05:00Z',
        assignedEmployees: [
          {
            employeeId: 'sup-1',
            firstName: 'Marta',
            lastName: 'Ríos',
            status: 'present',
            checkInAt: '2026-09-27T11:05:00Z',
          },
        ],
      }),
      isLoading: false,
      isError: false,
    } as never)

    renderDetail()

    expect(screen.queryByText('Calificar')).not.toBeInTheDocument()
    expect(screen.getByText('Vos')).toBeInTheDocument()
  })

  it('MOB-SUP-011: no ofrece calificar cuando el plazo de P-083 ya cerró', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({
        status: 'completed',
        checkInAt: '2026-09-27T11:05:00Z',
        checkOutAt: '2026-09-27T12:00:00Z',
        endsAt: '2020-01-01T12:00:00Z',
      }),
      isLoading: false,
      isError: false,
    } as never)

    renderDetail()

    expect(screen.queryByText('Calificar')).not.toBeInTheDocument()
    expect(
      screen.getByText('El plazo para calificar a este turno ya cerró.'),
    ).toBeInTheDocument()
  })
})
