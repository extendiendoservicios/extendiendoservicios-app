import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShiftObservationSection } from './ShiftObservationSection'

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

vi.mock('@/features/planning/queries', () => ({
  useUpdateShiftDetailsMutation: () => ({ mutateAsync, isPending: false }),
}))

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue(undefined)
})

describe('ShiftObservationSection (AJ3-06)', () => {
  it('sin observación muestra el campo vacío con placeholder y la casilla tildada', () => {
    render(
      <ShiftObservationSection
        shiftId="s1"
        requiredStaff={2}
        notes={null}
        showInPrint={null}
      />,
    )
    const field = screen.getByLabelText('Observación')
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder')
    expect(
      screen.getByRole('checkbox', { name: 'Mostrar en la impresión' }),
    ).toBeChecked()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('guarda texto y casilla con la dotación actual', async () => {
    render(
      <ShiftObservationSection
        shiftId="s1"
        requiredStaff={2}
        notes="Vieja"
        showInPrint
      />,
    )
    fireEvent.change(screen.getByLabelText('Observación'), {
      target: { value: '  Llevar llaves  ' },
    })
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Mostrar en la impresión' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        shiftId: 's1',
        requiredStaff: 2,
        notes: 'Llevar llaves',
        showInPrint: false,
      }),
    )
  })
})
