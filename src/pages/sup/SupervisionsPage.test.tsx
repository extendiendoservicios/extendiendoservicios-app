import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisionsPage from './SupervisionsPage'
import * as mySupervisionsModule from '@/api/mySupervisions'
import type { MySupervision } from '@/api/mySupervisions'

/**
 * SUP-07 (MOB-SUP-003): todas las supervisiones asignadas o en curso,
 * futuras incluidas. Mismo patrón de mocks que `TodayPage.test.tsx`.
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
    shiftOpenEnded: false,
    status: 'assigned',
    assignedAt: '2026-09-20T10:00:00Z',
    notDoneReason: null,
    cancelReason: null,
    generalNotes: null,
    criteriaSnapshot: null,
    checkInAt: null,
    checkOutAt: null,
    assignedEmployees: [],
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <SupervisionsPage />
    </MemoryRouter>,
  )
}

describe('SupervisionsPage (SUP-07)', () => {
  it('muestra el estado vacío sin supervisiones asignadas', () => {
    vi.spyOn(
      mySupervisionsModule,
      'useMySupervisionsPendingQuery',
    ).mockReturnValue({ data: [], isLoading: false, isError: false } as never)

    renderPage()

    expect(
      screen.getByText('No tenés supervisiones asignadas'),
    ).toBeInTheDocument()
  })

  it('lista las supervisiones asignadas o en curso con enlace al detalle', () => {
    vi.spyOn(
      mySupervisionsModule,
      'useMySupervisionsPendingQuery',
    ).mockReturnValue({
      data: [supervision({})],
      isLoading: false,
      isError: false,
    } as never)

    renderPage()

    const link = screen.getByText('Limpiadora SRL').closest('a')
    expect(link).toHaveAttribute('href', '/sup/supervisiones/sv1')
  })
})
