import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteShiftAction } from './DeleteShiftAction'

/** OD-22: «Eliminar turno» solo lo ve el dueño. */
const { authState } = vi.hoisted(() => ({
  authState: { roles: ['owner'] as string[] },
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => authState,
}))
vi.mock('@/features/ownerDelete/components/OwnerDeleteDialog', () => ({
  OwnerDeleteDialog: ({ open }: { open: boolean }) =>
    open ? <div>diálogo de borrado</div> : null,
}))

describe('DeleteShiftAction', () => {
  beforeEach(() => {
    authState.roles = ['owner']
  })

  it('el dueño ve «Eliminar turno»', () => {
    render(<DeleteShiftAction shiftId="s1" onDeleted={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: 'Eliminar turno' }),
    ).toBeInTheDocument()
  })

  it.each([['admin'], ['supervisor'], ['employee']])(
    'un %s no la ve',
    (role) => {
      authState.roles = [role]
      render(<DeleteShiftAction shiftId="s1" onDeleted={vi.fn()} />)
      expect(
        screen.queryByRole('button', { name: 'Eliminar turno' }),
      ).not.toBeInTheDocument()
    },
  )
})
