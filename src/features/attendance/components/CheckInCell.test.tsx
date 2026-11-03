import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeAssignment } from '@/features/dashboard/fixtures'
import { isLateArrival } from '@/features/attendance/derive'
import { CheckInCell } from './CheckInCell'

/** OD-17: llegada tarde = fichaje de inicio posterior al inicio programado, al minuto y sin tolerancia. */
const STARTS_AT = '2026-09-30T08:00:00-03:00'

describe('isLateArrival', () => {
  it('es tarde un minuto después del inicio', () => {
    expect(
      isLateArrival({
        startsAt: STARTS_AT,
        checkInAt: '2026-09-30T08:01:00-03:00',
      }),
    ).toBe(true)
  })

  it('a la hora exacta, o con segundos dentro del mismo minuto, no es tarde', () => {
    expect(isLateArrival({ startsAt: STARTS_AT, checkInAt: STARTS_AT })).toBe(
      false,
    )
    expect(
      isLateArrival({
        startsAt: STARTS_AT,
        checkInAt: '2026-09-30T08:00:45-03:00',
      }),
    ).toBe(false)
  })

  it('antes del inicio no es tarde', () => {
    expect(
      isLateArrival({
        startsAt: STARTS_AT,
        checkInAt: '2026-09-30T07:50:00-03:00',
      }),
    ).toBe(false)
  })

  it('sin fichaje o sin inicio programado no es tarde', () => {
    expect(isLateArrival({ startsAt: STARTS_AT, checkInAt: null })).toBe(false)
    expect(
      isLateArrival({ startsAt: null, checkInAt: '2026-09-30T09:00:00-03:00' }),
    ).toBe(false)
  })
})

describe('CheckInCell', () => {
  it('con llegada tarde muestra la hora con fondo amarillo y la píldora «Llegada tarde»', () => {
    render(
      <CheckInCell
        row={makeAssignment({
          startsAt: STARTS_AT,
          checkInAt: '2026-09-30T08:12:00-03:00',
        })}
      />,
    )
    expect(screen.getByTestId('late-arrival-cell')).toHaveClass('bg-warning-bg')
    expect(screen.getByText('08:12')).toBeInTheDocument()
    expect(screen.getByText('Llegada tarde')).toBeInTheDocument()
  })

  it('a tiempo muestra solo la hora', () => {
    render(
      <CheckInCell
        row={makeAssignment({
          startsAt: STARTS_AT,
          checkInAt: '2026-09-30T07:58:00-03:00',
        })}
      />,
    )
    expect(screen.getByText('07:58')).toBeInTheDocument()
    expect(screen.queryByTestId('late-arrival-cell')).toBeNull()
    expect(screen.queryByText('Llegada tarde')).toBeNull()
  })

  it('sin fichaje muestra un guion', () => {
    render(<CheckInCell row={makeAssignment({ checkInAt: null })} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
