import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EmployeeMultiPicker } from './EmployeeMultiPicker'

/** P19.11d: quien está de licencia el día del turno no se puede elegir. */
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}

const OPTIONS = [
  { profileId: 'e1', name: 'Ana Gómez', employeeNumber: 1 },
  { profileId: 'e2', name: 'Luis Díaz', employeeNumber: 2 },
]

describe('EmployeeMultiPicker con licencias', () => {
  it('deshabilita a quien está de licencia y avisa; el resto se puede elegir', () => {
    const onChange = vi.fn()
    render(
      <EmployeeMultiPicker
        options={OPTIONS}
        value={[]}
        onValueChange={onChange}
        max={2}
        blockedIds={new Set(['e2'])}
        partialLeaveIds={new Set(['e1'])}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Empleados' }))

    const blocked = screen.getByRole('option', { name: /Luis Díaz/ })
    expect(blocked).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('De licencia')).toBeInTheDocument()
    expect(
      screen.getByText('Licencia en parte del período'),
    ).toBeInTheDocument()

    fireEvent.click(blocked)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: /Ana Gómez/ }))
    expect(onChange).toHaveBeenCalledWith(['e1'])
  })
})
