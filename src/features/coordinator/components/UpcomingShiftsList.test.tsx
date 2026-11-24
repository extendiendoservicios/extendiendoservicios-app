import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UpcomingShiftsList } from './UpcomingShiftsList'
import { makeTodayShift } from '../fixtures'
import { renderRoute } from '../testUtils'

/** Detalle del día de SUP-10 · Próximos días (P32, D-06): «Mis sedes» y «Otras sedes», solo consulta. */
function renderList(
  shifts: ReturnType<typeof makeTodayShift>[] | undefined,
  options: { date?: string; isLoading?: boolean } = {},
) {
  const { date = '2026-11-25', isLoading = false } = options
  const isError = shifts === undefined && !isLoading
  return renderRoute(
    <UpcomingShiftsList
      date={date}
      shifts={shifts}
      isLoading={isLoading}
      isError={isError}
    />,
    { path: '/sup', entry: '/sup' },
  )
}

describe('UpcomingShiftsList', () => {
  it('muestra solo los turnos del día elegido y separa «Mis sedes» de «Otras sedes»', () => {
    renderList([
      makeTodayShift({
        shiftId: 'a',
        shiftDate: '2026-11-25',
        isPriority: true,
        siteName: 'Torre Norte',
      }),
      makeTodayShift({
        shiftId: 'b',
        shiftDate: '2026-11-26',
        siteName: 'Local Centro',
      }),
      makeTodayShift({
        shiftId: 'c',
        shiftDate: '2026-11-25',
        siteName: 'Depósito',
      }),
    ])

    expect(
      within(screen.getByRole('region', { name: 'Mis sedes' })).getByText(
        'Torre Norte',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Otras sedes' })).getByText(
        'Depósito',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Local Centro')).not.toBeInTheDocument()
  })

  it('es solo de consulta: sin enlaces al turno ni botones de acción', () => {
    renderList([makeTodayShift({ shiftDate: '2026-11-25' })])

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/Tomar|Supervisar$/)).not.toBeInTheDocument()
    expect(screen.getByTestId('upcoming-shift')).toBeInTheDocument()
  })

  it('el buscador filtra «Otras sedes» y no «Mis sedes»', () => {
    renderList([
      makeTodayShift({
        shiftId: 'p',
        shiftDate: '2026-11-25',
        isPriority: true,
        siteName: 'Torre Norte',
      }),
      makeTodayShift({
        shiftId: 'o1',
        shiftDate: '2026-11-25',
        siteName: 'Depósito',
      }),
      makeTodayShift({
        shiftId: 'o2',
        shiftDate: '2026-11-25',
        siteName: 'Local Centro',
      }),
    ])

    fireEvent.change(screen.getByLabelText('Buscar por cliente o sede'), {
      target: { value: 'deposito' },
    })
    expect(screen.getByText('Torre Norte')).toBeInTheDocument()
    expect(screen.getByText('Depósito')).toBeInTheDocument()
    expect(screen.queryByText('Local Centro')).not.toBeInTheDocument()
  })

  it('si la búsqueda no encuentra nada, lo dice', () => {
    renderList([
      makeTodayShift({ shiftDate: '2026-11-25', siteName: 'Depósito' }),
    ])
    fireEvent.change(screen.getByLabelText('Buscar por cliente o sede'), {
      target: { value: 'zzz' },
    })
    expect(
      screen.getByText('No encontramos turnos con esa búsqueda.'),
    ).toBeInTheDocument()
  })

  it('estado vacío por día, con el nombre del día', () => {
    renderList([makeTodayShift({ shiftDate: '2026-11-26' })], {
      date: '2026-11-25',
    })
    expect(
      screen.getByText('No hay turnos el miércoles 25 de noviembre'),
    ).toBeInTheDocument()
  })

  it('avisa si no se pudo cargar y muestra «Cargando…» mientras tanto', () => {
    const { unmount } = renderList(undefined)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No pudimos cargar los próximos turnos',
    )
    unmount()
    renderList(undefined, { isLoading: true })
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })
})
