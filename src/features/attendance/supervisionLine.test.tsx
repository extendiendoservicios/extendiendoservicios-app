import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeAssignment } from '@/features/dashboard/fixtures'
import { getSupervisionLine } from './supervisionLine'
import { SupervisionLine } from './components/SupervisionLine'

const started = {
  checkInAt: '2026-09-30T08:02:00-03:00',
  displayStatus: 'present',
}

describe('segunda línea de supervisión (D-10)', () => {
  it('Supervisado con el nombre del coordinador', () => {
    const row = makeAssignment({
      ...started,
      supervisionState: 'done',
      supervisorName: 'Sofía Ruiz',
    })
    expect(getSupervisionLine(row)?.label).toBe('Supervisado')
    render(<SupervisionLine row={row} />)
    const line = screen.getByText('Supervisado')
    expect(line).toHaveAttribute('title', 'Sofía Ruiz')
    expect(line).toHaveTextContent('por Sofía Ruiz')
  })

  it('Supervisando y Sin supervisión', () => {
    expect(
      getSupervisionLine(
        makeAssignment({ ...started, supervisionState: 'in_progress' }),
      )?.label,
    ).toBe('Supervisando')
    const none = makeAssignment({ ...started, supervisionState: 'none' })
    expect(getSupervisionLine(none)?.label).toBe('Sin supervisión')
    render(<SupervisionLine row={none} />)
    expect(screen.getByText('Sin supervisión')).not.toHaveAttribute('title')
  })

  it('no muestra nada si el turno todavía no empezó', () => {
    const row = makeAssignment({ supervisionState: 'none' })
    expect(getSupervisionLine(row)).toBeNull()
    expect(
      getSupervisionLine(
        makeAssignment({
          ...started,
          shiftStatus: 'cancelled',
          supervisionState: 'none',
        }),
      ),
    ).toBeNull()
  })

  it('no muestra nada si el dato no llegó (no es administración)', () => {
    expect(getSupervisionLine(makeAssignment(started))).toBeNull()
  })

  it('sin registro después de la hora sí muestra la línea', () => {
    expect(
      getSupervisionLine(
        makeAssignment({
          displayStatus: 'no_record',
          supervisionState: 'none',
        }),
      )?.label,
    ).toBe('Sin supervisión')
  })
})
