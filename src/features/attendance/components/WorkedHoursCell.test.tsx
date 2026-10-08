import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkedHoursCell } from './WorkedHoursCell'

const base = {
  workedMinutes: 240,
  plannedMinutes: 240,
  minutesEarlyLeave: null,
  checkInAt: '2026-10-05T11:00:00Z',
  checkOutAt: '2026-10-05T15:00:00Z',
}

describe('WorkedHoursCell (AJ-03)', () => {
  it('cumplió lo previsto: horas con tilde verde', () => {
    render(<WorkedHoursCell {...base} />)
    expect(screen.getByText('4 h')).toBeInTheDocument()
    expect(screen.getByText('Cumplió las horas previstas')).toBeInTheDocument()
  })

  it('faltó un minuto: advertencia con el motivo accesible y como tooltip', () => {
    render(<WorkedHoursCell {...base} workedMinutes={239} />)
    expect(screen.getByText('3 h 59 min')).toBeInTheDocument()
    expect(screen.getByText('Faltan 1 min')).toBeInTheDocument()
    expect(screen.getByTitle('Faltan 1 min')).toBeInTheDocument()
    expect(
      screen.queryByText('Cumplió las horas previstas'),
    ).not.toBeInTheDocument()
  })

  it('salida anticipada: advertencia aunque las horas alcancen', () => {
    render(<WorkedHoursCell {...base} minutesEarlyLeave={10} />)
    expect(screen.getByText('Salida anticipada')).toBeInTheDocument()
  })

  it('sin fin registrado: «en curso» o guion', () => {
    const { rerender } = render(
      <WorkedHoursCell {...base} workedMinutes={null} checkOutAt={null} />,
    )
    expect(screen.getByText('en curso')).toBeInTheDocument()
    rerender(
      <WorkedHoursCell
        {...base}
        workedMinutes={null}
        checkInAt={null}
        checkOutAt={null}
      />,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
