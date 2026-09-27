import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisionDetailPage from './SupervisionDetailPage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision } from '@/api/mySupervisions'

/**
 * SUP-03 (MOB-SUP-004): sede, franja, empleados con su estado de asistencia
 * e inicio real, tareas en solo lectura y la guía de criterios. El botón
 * "Registrar inicio de supervisión" aparece con la supervisión asignada o en
 * curso, y no con una ya cerrada. Mismo patrón de mocks que
 * `src/pages/app/ServiceDetailPage.tsx` no tiene test propio, así que se
 * sigue el de `TasksPage.test.tsx`: se reemplazan los hooks del módulo de
 * datos en vez de un `QueryClientProvider` real.
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
        status: 'present',
        checkInAt: '2026-09-27T11:05:00Z',
      },
    ],
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SupervisionDetailPage (SUP-03)', () => {
  it('muestra el cliente, la sede, la franja y los empleados con su estado e inicio real', () => {
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)
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

    renderDetail()

    expect(screen.getByText('Limpiadora SRL')).toBeInTheDocument()
    expect(screen.getByText('Sede Centro')).toBeInTheDocument()
    expect(screen.getByText('08:00–12:00')).toBeInTheDocument()
    expect(screen.getAllByText('Ana Gómez').length).toBeGreaterThan(0)
    expect(screen.getByText('Inicio: 08:05')).toBeInTheDocument()
  })

  it('ofrece "Registrar inicio de supervisión" cuando está asignada o en curso', () => {
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({ status: 'assigned' }),
      isLoading: false,
      isError: false,
    } as never)
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

    renderDetail()

    const link = screen
      .getByText('Registrar inicio de supervisión')
      .closest('a')
    expect(link).toHaveAttribute('href', '/sup/supervisiones/sv1/registro')
  })

  it('no ofrece el registro cuando la supervisión ya está completada', () => {
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({ status: 'completed' }),
      isLoading: false,
      isError: false,
    } as never)
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

    renderDetail()

    expect(
      screen.queryByText('Registrar inicio de supervisión'),
    ).not.toBeInTheDocument()
  })

  it('muestra los criterios vigentes como guía desplegable', () => {
    vi.spyOn(mySupervisionsModule, 'useMySupervisionQuery').mockReturnValue({
      data: supervision({}),
      isLoading: false,
      isError: false,
    } as never)
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
})
