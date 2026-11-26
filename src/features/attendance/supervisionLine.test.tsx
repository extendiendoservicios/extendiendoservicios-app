import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeAssignment } from '@/features/dashboard/fixtures'
import { getSupervisionLine } from './supervisionLine'
import {
  SupervisionBadge,
  supervisionSortKey,
} from './components/SupervisionBadge'

const started = {
  checkInAt: '2026-09-30T08:02:00-03:00',
  displayStatus: 'present',
}

describe('píldora de supervisión (D-10, P35)', () => {
  it('Supervisado con el nombre del coordinador', () => {
    const row = makeAssignment({
      ...started,
      supervisionState: 'done',
      supervisorName: 'Sofía Ruiz',
    })
    expect(getSupervisionLine(row)?.label).toBe('Supervisado')
    render(<SupervisionBadge row={row} />)
    const line = screen.getByText('Supervisado')
    expect(line).toHaveAttribute('title', 'Sofía Ruiz')
    expect(line).toHaveTextContent('por Sofía Ruiz')
  })

  it('Supervisando y Sin supervisar', () => {
    expect(
      getSupervisionLine(
        makeAssignment({ ...started, supervisionState: 'in_progress' }),
      )?.label,
    ).toBe('Supervisando')
    const none = makeAssignment({ ...started, supervisionState: 'none' })
    expect(getSupervisionLine(none)?.label).toBe('Sin supervisar')
    render(<SupervisionBadge row={none} />)
    expect(screen.getByText('Sin supervisar')).not.toHaveAttribute('title')
  })

  it('«Supervisado» usa el verde de «Finalizado» y «Sin supervisar» el rojo de «Sin registro»', () => {
    const done = makeAssignment({ ...started, supervisionState: 'done' })
    const none = makeAssignment({ ...started, supervisionState: 'none' })
    const doing = makeAssignment({
      ...started,
      supervisionState: 'in_progress',
    })
    render(
      <>
        <SupervisionBadge row={done} />
        <SupervisionBadge row={none} />
        <SupervisionBadge row={doing} />
      </>,
    )
    expect(screen.getByText('Supervisado')).toHaveClass(
      'bg-success-bg',
      'text-success-800',
    )
    expect(screen.getByText('Sin supervisar')).toHaveClass(
      'bg-danger-bg',
      'text-danger-800',
    )
    expect(screen.getByText('Supervisando')).toHaveClass(
      'bg-primary-100',
      'text-primary-800',
    )
  })

  it('sin píldora muestra «—» y no tiene clave de orden', () => {
    const row = makeAssignment({ supervisionState: 'none' })
    render(<SupervisionBadge row={row} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(supervisionSortKey(row)).toBeUndefined()
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
    ).toBe('Sin supervisar')
  })
})
