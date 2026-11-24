import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpcomingShiftsList } from './UpcomingShiftsList'
import * as todayModule from '@/api/supervisorToday'
import { makeTodayShift } from '../fixtures'
import { renderRoute } from '../testUtils'

/** Lista de SUP-10 · Próximos días (D-09): por día, «Mis sedes» y «Otras sedes», solo consulta. */
function mockUpcoming(
  data: ReturnType<typeof makeTodayShift>[] | undefined,
  isLoading = false,
) {
  vi.spyOn(todayModule, 'useSupervisorUpcomingQuery').mockReturnValue({
    data,
    isLoading,
    isError: data === undefined && !isLoading,
  } as never)
}

function renderList() {
  return renderRoute(<UpcomingShiftsList />, { path: '/sup', entry: '/sup' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UpcomingShiftsList', () => {
  it('agrupa por día y separa «Mis sedes» de «Otras sedes» dentro de cada día', () => {
    mockUpcoming([
      makeTodayShift({
        shiftId: 'a',
        shiftDate: '2026-10-25',
        isPriority: true,
        siteName: 'Torre Norte',
      }),
      makeTodayShift({
        shiftId: 'b',
        shiftDate: '2026-10-24',
        siteName: 'Local Centro',
      }),
      makeTodayShift({
        shiftId: 'c',
        shiftDate: '2026-10-25',
        siteName: 'Depósito',
      }),
    ])
    renderList()

    const days = screen.getAllByRole('heading', { level: 2 })
    expect(days.map((h) => h.textContent)).toEqual([
      '24 oct 2026',
      '25 oct 2026',
    ])
    const day25 = screen.getByRole('region', { name: '25 oct 2026' })
    expect(
      within(
        within(day25).getByRole('region', { name: 'Mis sedes' }),
      ).getByText('Torre Norte'),
    ).toBeInTheDocument()
    expect(
      within(
        within(day25).getByRole('region', { name: 'Otras sedes' }),
      ).getByText('Depósito'),
    ).toBeInTheDocument()
  })

  it('es solo de consulta: sin enlaces al turno ni botones de acción', () => {
    mockUpcoming([makeTodayShift({ shiftDate: '2026-10-24' })])
    renderList()

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/Tomar|Supervisar$/)).not.toBeInTheDocument()
    expect(screen.getByTestId('upcoming-shift')).toBeInTheDocument()
  })

  it('el buscador filtra «Otras sedes» y no «Mis sedes»', () => {
    mockUpcoming([
      makeTodayShift({
        shiftId: 'p',
        shiftDate: '2026-10-24',
        isPriority: true,
        siteName: 'Torre Norte',
      }),
      makeTodayShift({
        shiftId: 'o1',
        shiftDate: '2026-10-24',
        siteName: 'Depósito',
      }),
      makeTodayShift({
        shiftId: 'o2',
        shiftDate: '2026-10-24',
        siteName: 'Local Centro',
      }),
    ])
    renderList()

    fireEvent.change(screen.getByLabelText('Buscar por cliente o sede'), {
      target: { value: 'deposito' },
    })
    expect(screen.getByText('Torre Norte')).toBeInTheDocument()
    expect(screen.getByText('Depósito')).toBeInTheDocument()
    expect(screen.queryByText('Local Centro')).not.toBeInTheDocument()
  })

  it('si la búsqueda no encuentra nada en ningún día, lo dice', () => {
    mockUpcoming([
      makeTodayShift({ shiftDate: '2026-10-24', siteName: 'Depósito' }),
    ])
    renderList()
    fireEvent.change(screen.getByLabelText('Buscar por cliente o sede'), {
      target: { value: 'zzz' },
    })
    expect(
      screen.getByText('No encontramos turnos con esa búsqueda.'),
    ).toBeInTheDocument()
  })

  it('estado vacío amable sin turnos en los próximos días', () => {
    mockUpcoming([])
    renderList()
    expect(
      screen.getByText('No hay turnos en los próximos días'),
    ).toBeInTheDocument()
  })

  it('avisa si no se pudo cargar y muestra «Cargando…» mientras tanto', () => {
    mockUpcoming(undefined)
    const { unmount } = renderList()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No pudimos cargar los próximos turnos',
    )
    unmount()
    mockUpcoming(undefined, true)
    renderList()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })
})
