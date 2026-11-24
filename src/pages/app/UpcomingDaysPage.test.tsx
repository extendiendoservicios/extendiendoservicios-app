import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UpcomingDaysPage from './UpcomingDaysPage'
import * as queriesModule from '@/features/employee/queries'
import type { MyDayAssignment } from '@/api/myDay'

/** Próximos días del empleado (P32, D-07). Hoy simulado: 24/11/2026 (mañana = 25/11). */
function mockServices(
  data: Partial<MyDayAssignment>[] | undefined,
  isError = false,
) {
  return vi.spyOn(queriesModule, 'useMyServicesMonthQuery').mockReturnValue({
    data: data?.map((d) => ({
      assignmentId: 'a1',
      shiftDate: '2026-11-25',
      isToday: false,
      siteName: 'Sede Centro',
      startTime: '08:00:00',
      endTime: '12:00:00',
      openEnded: false,
      noCheckout: false,
      status: 'expected',
      shiftStatus: 'assigned',
      checkInAt: null,
      checkOutAt: null,
      lastNoticeKind: null,
      ...d,
    })),
    isLoading: false,
    isError,
  } as never)
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <UpcomingDaysPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-24T15:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('UpcomingDaysPage', () => {
  it('abre en mañana con sus servicios, pidiendo el mes visible', () => {
    const spy = mockServices([
      { assignmentId: 'a1', siteName: 'Sede Centro' },
      { assignmentId: 'a2', shiftDate: '2026-11-27', siteName: 'Sede Sur' },
    ])
    renderPage()

    expect(spy).toHaveBeenCalledWith('2026-11', '2026-11-01', '2026-11-30')
    expect(screen.getByText(/Sede Centro/)).toBeInTheDocument()
    expect(screen.queryByText(/Sede Sur/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sede Centro/ })).toHaveAttribute(
      'href',
      '/app/servicio/a1',
    )
  })

  it('un día sin servicios dice «No tenés servicios el …» y no deja elegir hoy', () => {
    mockServices([{ assignmentId: 'a2', shiftDate: '2026-11-27' }])
    renderPage()

    expect(
      screen.getByText('No tenés servicios el miércoles 25 de noviembre'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /martes 24 de noviembre de 2026/ }),
    ).toBeDisabled()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'viernes 27 de noviembre de 2026, con servicios',
      }),
    )
    expect(screen.getByText(/Sede Centro/)).toBeInTheDocument()
  })

  it('avisa si no pudo cargar', () => {
    mockServices(undefined, true)
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No pudimos cargar tus servicios',
    )
  })
})
