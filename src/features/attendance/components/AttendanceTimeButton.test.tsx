import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { at, makeAssignment } from '@/features/dashboard/fixtures'
import { AttendanceTimeButton } from './AttendanceTimeButton'

/**
 * OF-06 y OF-07: «Corregir» si hay fichaje, «Registrar» si falta, solo para
 * quien gestiona la asistencia.
 */

vi.mock('./RecordAttendanceSheet', () => ({
  RecordAttendanceSheet: ({ actions }: { actions: string[] }) => (
    <div role="dialog" aria-label="Registrar en nombre">
      {actions.join(',')}
    </div>
  ),
}))

vi.mock('@/features/geo/components/CorrectTimeDialog', () => ({
  CorrectTimeDialog: ({
    recordId,
    kind,
  }: {
    recordId: string
    kind: string
  }) => (
    <div role="dialog" aria-label="Corregir hora">
      {kind}:{recordId}
    </div>
  ),
}))

const geo = (recordId: string) => ({
  recordId,
  status: 'valid' as const,
  reason: null,
  distanceM: null,
  radiusM: null,
  accuracyM: null,
  outsideReason: null,
  overridden: false,
  timeCorrected: false,
})

describe('AttendanceTimeButton', () => {
  it('con fichaje ofrece «Corregir» y abre el diálogo de corrección con el id del fichaje', () => {
    const row = makeAssignment({
      shiftStatus: 'in_progress',
      status: 'present',
      checkInAt: at('08:05'),
      checkInGeo: geo('rec-in'),
    })
    render(<AttendanceTimeButton row={row} kind="check_in" canManage />)
    fireEvent.click(screen.getByRole('button', { name: /Corregir inicio/ }))
    expect(
      screen.getByRole('dialog', { name: 'Corregir hora' }),
    ).toHaveTextContent('check_in:rec-in')
  })

  it('sin fin pero con inicio ofrece «Registrar» con el fin elegido de entrada', () => {
    const row = makeAssignment({
      shiftStatus: 'in_progress',
      status: 'present',
      checkInAt: at('08:05'),
      checkInGeo: geo('rec-in'),
    })
    render(<AttendanceTimeButton row={row} kind="check_out" canManage />)
    fireEvent.click(screen.getByRole('button', { name: /Registrar fin/ }))
    expect(
      screen.getByRole('dialog', { name: 'Registrar en nombre' }),
    ).toHaveTextContent(/^check_out/)
  })

  it('sin inicio ofrece «Registrar» el inicio', () => {
    const row = makeAssignment({
      shiftStatus: 'assigned',
      status: 'expected',
      startsAt: at('08:00'),
    })
    render(<AttendanceTimeButton row={row} kind="check_in" canManage />)
    expect(
      screen.getByRole('button', { name: /Registrar inicio/ }),
    ).toBeInTheDocument()
  })

  it('no ofrece registrar el fin si no hay inicio', () => {
    const row = makeAssignment({ shiftStatus: 'assigned', status: 'expected' })
    const { container } = render(
      <AttendanceTimeButton row={row} kind="check_out" canManage />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('sin la capacidad no muestra nada', () => {
    const row = makeAssignment({
      shiftStatus: 'in_progress',
      status: 'present',
      checkInAt: at('08:05'),
      checkInGeo: geo('rec-in'),
    })
    const { container } = render(
      <AttendanceTimeButton row={row} kind="check_in" canManage={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
