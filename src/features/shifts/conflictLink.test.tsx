import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, parseConflictDetail } from '@/api/errors'
import {
  ConflictShiftLink,
  conflictShiftIdOf,
  conflictToastOptions,
  shiftPath,
} from './conflictLink'

const DETAIL = parseConflictDetail({ conflict_shift_id: 'sh-9' })

describe('ConflictShiftLink (OF-08)', () => {
  it('abre el turno con el que choca', () => {
    const onOpen = vi.fn()
    render(<ConflictShiftLink detail={DETAIL} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver turno' }))
    expect(onOpen).toHaveBeenCalledWith('/admin/turnos/sh-9')
  })

  it('no muestra nada si el servidor no mandó el turno', () => {
    const { container } = render(
      <ConflictShiftLink detail={null} onOpen={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(conflictShiftIdOf(parseConflictDetail({ leaves: [] }))).toBeNull()
  })

  it('arma la acción «Ver turno» de un aviso solo si hay turno', () => {
    const onOpen = vi.fn()
    const withShift = new ApiError('Choca.', 'ASSIGNMENT_OVERLAP', DETAIL)
    const options = conflictToastOptions(withShift, onOpen)
    expect(options?.action.label).toBe('Ver turno')
    options?.action.onClick()
    expect(onOpen).toHaveBeenCalledWith(shiftPath('sh-9'))
    expect(
      conflictToastOptions(new ApiError('Licencia.', 'ON_LEAVE'), onOpen),
    ).toBeUndefined()
    expect(conflictToastOptions(new Error('x'), onOpen)).toBeUndefined()
  })
})
