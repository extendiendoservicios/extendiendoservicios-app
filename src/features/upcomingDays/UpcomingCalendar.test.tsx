import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UpcomingCalendar } from './UpcomingCalendar'

/** Minicalendario de «Próximos días» (P32, D-05). Hoy simulado: 24/11/2026; rango 25/11..23/1. */
function setup(
  overrides: Partial<Parameters<typeof UpcomingCalendar>[0]> = {},
) {
  const props = {
    month: '2026-11',
    onMonthChange: vi.fn(),
    selected: '2026-11-25',
    onSelect: vi.fn(),
    markedDates: new Set(['2026-11-27']),
    min: '2026-11-25',
    max: '2027-01-23',
    ...overrides,
  }
  render(<UpcomingCalendar {...props} />)
  return props
}

describe('UpcomingCalendar', () => {
  it('rotula el mes y cada día con la fecha completa; el elegido queda marcado', () => {
    setup()
    expect(screen.getByText('noviembre 2026')).toBeInTheDocument()
    const selected = screen.getByRole('button', {
      name: 'miércoles 25 de noviembre de 2026',
    })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(selected).toHaveAttribute('aria-current', 'date')
    const other = screen.getByRole('button', {
      name: /jueves 26 de noviembre de 2026/,
    })
    expect(other).toHaveAttribute('aria-pressed', 'false')
    expect(other).not.toHaveAttribute('aria-current')
  })

  it('marca con punto los días con servicios y lo anuncia', () => {
    setup()
    const marked = screen.getByRole('button', {
      name: 'viernes 27 de noviembre de 2026, con servicios',
    })
    expect(marked).toHaveAttribute('data-has-items', 'true')
  })

  it('deshabilita los días fuera de mañana..hoy + 60', () => {
    setup()
    expect(
      screen.getByRole('button', { name: /martes 24 de noviembre de 2026/ }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /jueves 26 de noviembre de 2026/ }),
    ).toBeEnabled()
  })

  it('elegir un día avisa con la fecha', () => {
    const props = setup()
    fireEvent.click(
      screen.getByRole('button', { name: /jueves 26 de noviembre de 2026/ }),
    )
    expect(props.onSelect).toHaveBeenCalledWith('2026-11-26')
  })

  it('no deja ir a un mes anterior sin días habilitados, pero sí al siguiente', () => {
    const props = setup()
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }))
    expect(props.onMonthChange).toHaveBeenCalledWith('2026-12')
  })

  it('en el último mes habilitado no deja avanzar y sí volver', () => {
    const props = setup({ month: '2027-01', selected: '2027-01-02' })
    expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /sábado 23 de enero de 2027/ }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: /domingo 24 de enero de 2027/ }),
    ).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }))
    expect(props.onMonthChange).toHaveBeenCalledWith('2026-12')
  })
})
