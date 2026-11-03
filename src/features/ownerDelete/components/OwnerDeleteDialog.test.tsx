import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnerDeletePreview } from '@/api/ownerDelete'
import { ApiError } from '@/api/errors'
import { OwnerDeleteDialog } from './OwnerDeleteDialog'

/**
 * OD-22 y OD-23: el diálogo de borrado del dueño. Se mockean los hooks de
 * consulta y de mutación.
 */
const { state, mutateAsyncMock } = vi.hoisted(() => ({
  state: {
    preview: undefined as { name: string } | undefined,
    error: null as Error | null,
  },
  mutateAsyncMock: vi.fn(),
}))

vi.mock('@/features/ownerDelete/queries', () => ({
  useOwnerDeletePreviewQuery: () => ({
    data: state.preview,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useOwnerDeleteMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
    error: state.error,
    reset: vi.fn(),
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makePreview(
  overrides: Partial<OwnerDeletePreview> = {},
): OwnerDeletePreview {
  return {
    entity: 'client',
    id: 'c1',
    name: 'Fantasía SA',
    canDelete: true,
    blockers: [],
    willDelete: [{ code: 'contacts', label: 'Contactos', count: 3 }],
    alternativeNames: [],
    fromDate: null,
    deletableCount: null,
    skipped: [],
    ...overrides,
  }
}

function renderDialog(kind: 'client' | 'shift' | 'employee' = 'client') {
  return render(
    <OwnerDeleteDialog kind={kind} id="c1" open onOpenChange={vi.fn()} />,
  )
}

describe('OwnerDeleteDialog', () => {
  beforeEach(() => {
    mutateAsyncMock.mockReset()
    state.error = null
    state.preview = makePreview()
  })

  it('avisa que es irreversible y lista lo que se borra', () => {
    renderDialog()
    expect(screen.getByText(/irreversible/i)).toBeInTheDocument()
    expect(screen.getByText(/alterar registros/i)).toBeInTheDocument()
    expect(screen.getByText('Contactos: 3')).toBeInTheDocument()
  })

  it('con bloqueos muestra cada mensaje y no deja confirmar', () => {
    state.preview = makePreview({
      canDelete: false,
      blockers: [
        { code: 'HAS_SITES', count: 2, message: 'Todavía tiene 2 sedes.' },
        {
          code: 'HAS_SERVICES',
          count: 1,
          message: 'Todavía tiene 1 servicio.',
        },
      ],
    })
    renderDialog()
    expect(screen.getByText('Todavía tiene 2 sedes.')).toBeInTheDocument()
    expect(screen.getByText('Todavía tiene 1 servicio.')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Eliminar' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/escribí/i)).not.toBeInTheDocument()
  })

  it('pide escribir el nombre y recién entonces habilita «Eliminar»', async () => {
    mutateAsyncMock.mockResolvedValue({
      entity: 'client',
      id: 'c1',
      name: 'Fantasía SA',
      deleted: {},
      skippedCount: 0,
    })
    renderDialog()
    const button = screen.getByRole('button', { name: 'Eliminar' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Para confirmar, escribí/), {
      target: { value: 'otro nombre' },
    })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Para confirmar, escribí/), {
      target: { value: 'fantasía sa' },
    })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() =>
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        kind: 'client',
        id: 'c1',
        confirmName: 'fantasía sa',
        fromDate: undefined,
      }),
    )
  })

  it('el turno no pide el nombre', () => {
    state.preview = makePreview({ entity: 'shift', name: 'Sede · 03/11/2026' })
    renderDialog('shift')
    expect(screen.queryByLabelText(/escribí/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeEnabled()
  })

  it('si Auth falló al borrar un empleado, ofrece reintentar', async () => {
    state.preview = makePreview({ entity: 'employee', name: 'Ana Gómez' })
    mutateAsyncMock.mockRejectedValue(
      new ApiError('No pudimos borrar el acceso.', 'AUTH_DELETE_FAILED'),
    )
    state.error = new ApiError(
      'No pudimos borrar el acceso.',
      'AUTH_DELETE_FAILED',
    )
    renderDialog('employee')
    fireEvent.change(screen.getByLabelText(/Para confirmar, escribí/), {
      target: { value: 'Ana Gómez' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(
      await screen.findByRole('button', { name: 'Reintentar' }),
    ).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No pudimos borrar el acceso.',
    )
  })
})
