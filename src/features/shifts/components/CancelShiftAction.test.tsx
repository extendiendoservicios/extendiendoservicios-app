import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CancelShiftAction } from './CancelShiftAction'

/**
 * ADM-06: la acción «Cancelar turno» respeta rol/capacidad y estado, igual
 * que ADM-05, y confirma con motivo obligatorio. Se mockea auth y la mutación.
 */
const { authState, mutateAsyncMock } = vi.hoisted(() => ({
  authState: {
    roles: ['owner'] as string[],
    capabilities: [] as string[],
  },
  mutateAsyncMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => authState,
}))
vi.mock('@/features/shifts/queries', () => ({
  useCancelShiftMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}))
vi.mock('@/features/planning/queries', () => ({
  planningKeys: { all: ['planning'] },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderAction(status: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CancelShiftAction
        shift={{ id: 's1', shiftDate: '2026-10-05', status }}
      />
    </QueryClientProvider>,
  )
}

describe('CancelShiftAction', () => {
  beforeEach(() => {
    authState.roles = ['owner']
    authState.capabilities = []
    mutateAsyncMock.mockClear()
  })

  it.each(['scheduled', 'assigned', 'in_progress'])(
    'se ofrece en un turno %s',
    (status) => {
      renderAction(status)
      expect(
        screen.getByRole('button', { name: 'Cancelar turno' }),
      ).toBeInTheDocument()
    },
  )

  it.each(['completed', 'cancelled'])(
    'no se ofrece en un turno %s',
    (status) => {
      renderAction(status)
      expect(
        screen.queryByRole('button', { name: /Cancelar turno/ }),
      ).toBeNull()
    },
  )

  it('un administrador sin cancel_shifts no la ve; con la capacidad sí', () => {
    authState.roles = ['admin']
    const { unmount } = renderAction('scheduled')
    expect(screen.queryByRole('button', { name: /Cancelar turno/ })).toBeNull()
    unmount()
    authState.capabilities = ['cancel_shifts']
    renderAction('scheduled')
    expect(
      screen.getByRole('button', { name: 'Cancelar turno' }),
    ).toBeInTheDocument()
  })

  it('pide motivo y cancela con él', async () => {
    renderAction('assigned')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancelar turno' })
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancelar turno',
    )!
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Motivo de la cancelación'), {
      target: { value: 'El cliente suspendió' },
    })
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        shiftId: 's1',
        reason: 'El cliente suspendió',
      }),
    )
  })
})
