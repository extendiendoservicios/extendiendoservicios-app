import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RateEmployeePage from './RateEmployeePage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision } from '@/api/mySupervisions'
import * as authModule from '@/features/auth/AuthProvider'
import type { AuthContextValue } from '@/features/auth/AuthProvider'
import * as onlineModule from '@/features/employee/useOnlineStatus'

/**
 * SUP-05 (MOB-SUP-006, MOB-SUP-011, CB-13): puntaje editable (`StarRating`),
 * comentario opcional y guardado (`rate_employee`, upsert). No ofrece el
 * formulario cuando la asignación es la del propio supervisor (CB-13), la
 * supervisión no está activa, o el plazo de P-083 ya cerró (MOB-SUP-011).
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
    // Lejos en el futuro a propósito: la ventana de P-083 no puede depender
    // del reloj real de la máquina que corre el test.
    endsAt: '2030-01-01T12:00:00Z',
    shiftOpenEnded: false,
    status: 'in_progress',
    assignedAt: '2026-09-20T10:00:00Z',
    notDoneReason: null,
    cancelReason: null,
    generalNotes: null,
    criteriaSnapshot: null,
    checkInAt: '2026-09-27T11:00:00Z',
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sup/supervisiones/sv1/calificar/a1']}>
      <Routes>
        <Route
          path="/sup/supervisiones/:id/calificar/:assignmentId"
          element={<RateEmployeePage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

/** Mockea los hooks comunes, con valores neutros que un test puede pisar. */
function mockCommon() {
  vi.spyOn(onlineModule, 'useOnlineStatus').mockReturnValue(true)
  vi.spyOn(
    mySupervisionsModule,
    'useSupervisionAssignmentsQuery',
  ).mockReturnValue({
    data: [{ assignmentId: 'a1', employeeId: 'e1' }],
    isLoading: false,
  } as never)
  vi.spyOn(mySupervisionsModule, 'useSupervisionRatingsQuery').mockReturnValue({
    data: [],
    isLoading: false,
  } as never)
  vi.spyOn(mySupervisionsModule, 'usePeopleAvatarsQuery').mockReturnValue({
    data: {},
  } as never)
  vi.spyOn(
    mySupervisionsModule,
    'useVigentRatingCriteriaQuery',
  ).mockReturnValue({ data: [] } as never)
  vi.spyOn(authModule, 'useAuth').mockReturnValue(authValue({}))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RateEmployeePage (SUP-05)', () => {
  it('muestra el nombre del empleado y permite elegir un puntaje', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)
    const mutateAsync = vi.fn().mockResolvedValue({})
    vi.spyOn(mySupervisionsModule, 'useRateEmployeeMutation').mockReturnValue({
      mutateAsync,
      isPending: false,
    } as never)

    renderPage()

    expect(screen.getAllByText('Ana Gómez').length).toBeGreaterThan(0)
    const saveButton = screen.getByRole('button', {
      name: 'Guardar calificación',
    })
    expect(saveButton).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: '4 de 5 estrellas' }))
    expect(saveButton).toBeEnabled()

    fireEvent.click(saveButton)
    expect(mutateAsync).toHaveBeenCalledWith({
      supervisionId: 'sv1',
      assignmentId: 'a1',
      score: 4,
      comment: undefined,
    })
  })

  it('prellena el puntaje y el comentario si ya existe una calificación cargada', () => {
    mockCommon()
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionRatingsQuery',
    ).mockReturnValue({
      data: [
        { id: 'r1', assignmentId: 'a1', score: 3, comment: 'Bien, prolijo' },
      ],
      isLoading: false,
    } as never)
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(mySupervisionsModule, 'useRateEmployeeMutation').mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)

    renderPage()

    expect(
      screen.getByRole('radio', { name: '3 de 5 estrellas' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByDisplayValue('Bien, prolijo')).toBeInTheDocument()
  })

  it('CB-13: no ofrece el formulario cuando la asignación es la del propio supervisor', () => {
    mockCommon()
    vi.spyOn(
      mySupervisionsModule,
      'useSupervisionAssignmentsQuery',
    ).mockReturnValue({
      data: [{ assignmentId: 'a1', employeeId: 'sup-1' }],
      isLoading: false,
    } as never)
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({
        assignedEmployees: [
          {
            employeeId: 'sup-1',
            firstName: 'Marta',
            lastName: 'Ríos',
            status: 'present',
            checkInAt: null,
          },
        ],
      }),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(mySupervisionsModule, 'useRateEmployeeMutation').mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)

    renderPage()

    expect(
      screen.getByText('No podés calificarte a vos mismo.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: 'Calificación' }),
    ).not.toBeInTheDocument()
  })

  it('MOB-SUP-011: no ofrece el formulario cuando el plazo de P-083 ya cerró', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({ endsAt: '2020-01-01T12:00:00Z' }),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(mySupervisionsModule, 'useRateEmployeeMutation').mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)

    renderPage()

    expect(
      screen.getByText('El plazo para editar esta calificación terminó.'),
    ).toBeInTheDocument()
  })

  it('no ofrece el formulario cuando la supervisión todavía no empezó', () => {
    mockCommon()
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({ status: 'assigned', checkInAt: null }),
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(mySupervisionsModule, 'useRateEmployeeMutation').mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)

    renderPage()

    expect(
      screen.getByText('Esta supervisión no está en curso ni completada.'),
    ).toBeInTheDocument()
  })
})
