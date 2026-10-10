import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryPage from './HistoryPage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision } from '@/api/mySupervisions'

/**
 * SUP-08 (MOB-SUP-008): lista de supervisiones completadas y no realizadas,
 * con sede y puntajes (promedio de las calificaciones cargadas y cuántos
 * empleados quedaron calificados sobre el total del turno). Enlaza a SUP-03
 * en modo lectura.
 */
function supervision(overrides: Partial<MySupervision>): MySupervision {
  return {
    id: 'sv1',
    shiftId: 'sh1',
    shiftDate: '2026-09-20',
    isToday: false,
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
    endsAt: '2026-09-20T12:00:00Z',
    shiftOpenEnded: false,
    status: 'completed',
    assignedAt: '2026-09-19T10:00:00Z',
    notDoneReason: null,
    cancelReason: null,
    generalNotes: null,
    criteriaSnapshot: null,
    checkInAt: '2026-09-20T08:05:00Z',
    checkOutAt: '2026-09-20T12:00:00Z',
    assignedEmployees: [
      {
        employeeId: 'e1',
        firstName: 'Ana',
        lastName: 'Gómez',
        status: 'finished',
        checkInAt: '2026-09-20T08:00:00Z',
      },
    ],
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sup/historial']}>
      <HistoryPage />
    </MemoryRouter>,
  )
}

describe('HistoryPage (SUP-08)', () => {
  it('muestra el cliente, la sede, la fecha y el promedio de calificaciones', () => {
    vi.spyOn(
      mySupervisionsModule,
      'useMySupervisionsHistoryQuery',
    ).mockReturnValue({
      data: [supervision({})],
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(
      mySupervisionsModule,
      'useHistoryRatingsSummaryQuery',
    ).mockReturnValue({
      data: [{ supervisionId: 'sv1', ratedCount: 1, averageScore: 4 }],
    } as never)

    renderPage()

    expect(screen.getByText('Limpiadora SRL')).toBeInTheDocument()
    expect(screen.getByText('Sede Centro')).toBeInTheDocument()
    expect(screen.getByText('1 de 1 calificado')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: '4 de 5 estrellas' }),
    ).toBeInTheDocument()
  })

  it('muestra el motivo cuando la supervisión quedó como no realizada', () => {
    vi.spyOn(
      mySupervisionsModule,
      'useMySupervisionsHistoryQuery',
    ).mockReturnValue({
      data: [
        supervision({
          status: 'not_done',
          notDoneReason: 'El cliente cerró la sede',
          checkInAt: null,
          checkOutAt: null,
        }),
      ],
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(
      mySupervisionsModule,
      'useHistoryRatingsSummaryQuery',
    ).mockReturnValue({ data: [] } as never)

    renderPage()

    expect(
      screen.getByText('Motivo: El cliente cerró la sede'),
    ).toBeInTheDocument()
  })

  it('muestra el estado vacío cuando todavía no hay supervisiones cerradas', () => {
    vi.spyOn(
      mySupervisionsModule,
      'useMySupervisionsHistoryQuery',
    ).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as never)
    vi.spyOn(
      mySupervisionsModule,
      'useHistoryRatingsSummaryQuery',
    ).mockReturnValue({ data: [] } as never)

    renderPage()

    expect(
      screen.getByText('Todavía no cerraste ninguna supervisión'),
    ).toBeInTheDocument()
  })
})
