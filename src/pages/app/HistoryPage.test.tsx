import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryPage from './HistoryPage'
import * as queriesModule from '@/features/employee/queries'
import type { MyDayAssignment } from '@/api/myDay'

/** AJ4-06 · «Mis servicios anteriores»: tarjetas por fecha, «Ver más» y estados. */
function item(overrides: Partial<MyDayAssignment>): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-10-10',
    clientName: 'Limpia Ya',
    siteName: 'Sede Centro',
    photosNotAllowed: false,
    myPhotosCount: 2,
    myVideosCount: 1,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    noCheckout: false,
    status: 'present',
    shiftStatus: 'completed',
    checkInAt: '2026-10-10T11:02:00Z',
    checkOutAt: '2026-10-10T15:00:00Z',
    ...overrides,
  } as MyDayAssignment
}

function mockHistory(value: Record<string, unknown>) {
  vi.spyOn(queriesModule, 'useMyHistoryQuery').mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    ...value,
  } as never)
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>,
  )

afterEach(() => vi.restoreAllMocks())

describe('HistoryPage (empleado)', () => {
  it('muestra cargando, error y vacío', () => {
    mockHistory({ isLoading: true })
    const first = renderPage()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
    first.unmount()

    mockHistory({ isError: true })
    const second = renderPage()
    expect(screen.getByText(/No pudimos cargar/)).toBeInTheDocument()
    second.unmount()

    mockHistory({ data: { pages: [[]] } })
    renderPage()
    expect(
      screen.getByText('Todavía no tenés servicios anteriores'),
    ).toBeInTheDocument()
  })

  it('agrupa por fecha y cada tarjeta abre el comprobante desde el historial', () => {
    mockHistory({
      data: {
        pages: [
          [
            item({ assignmentId: 'a1' }),
            item({ assignmentId: 'a2', clientName: 'Otra SA' }),
            item({ assignmentId: 'a3', shiftDate: '2026-10-09' }),
          ],
        ],
      },
    })
    renderPage()

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2)
    expect(screen.getAllByText(/2 fotos y 1 video/)).toHaveLength(3)
    expect(screen.getByText('Otra SA').closest('a')).toHaveAttribute(
      'href',
      '/app/resumen/a2?desde=historial',
    )
    expect(screen.queryByText('Ver más')).not.toBeInTheDocument()
  })

  it('un turno cancelado se lista con su estado y sin cantidad de fotos', () => {
    mockHistory({
      data: {
        pages: [
          [
            item({
              shiftStatus: 'cancelled',
              checkInAt: null,
              checkOutAt: null,
            }),
          ],
        ],
      },
    })
    renderPage()
    expect(screen.getByText('Cancelado')).toBeInTheDocument()
    expect(screen.queryByText(/Fotos y videos/)).not.toBeInTheDocument()
  })

  it('«Ver más» pide la página siguiente', () => {
    const fetchNextPage = vi.fn()
    mockHistory({
      data: { pages: [[item({})]] },
      hasNextPage: true,
      fetchNextPage,
    })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Ver más' }))
    expect(fetchNextPage).toHaveBeenCalled()
  })
})
