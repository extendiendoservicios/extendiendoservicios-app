import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testItem } from '@/features/stock/testSupport'
import { AdjustStockDialog } from './AdjustStockDialog'

const { mutateAsyncMock, toastMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/features/stock/queries', () => ({
  useAdjustStockMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}))

const ITEM = testItem({ stockQty: 4 })

function renderDialog() {
  return render(<AdjustStockDialog item={ITEM} open onOpenChange={() => {}} />)
}

function chooseReason(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Motivo' }))
  fireEvent.click(screen.getByRole('option', { name: label }))
}

function typeQty(value: string) {
  fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value } })
}

beforeEach(() => {
  // jsdom no implementa scrollIntoView, que usa el Select de Radix al abrirse.
  Element.prototype.scrollIntoView = vi.fn()
  mutateAsyncMock.mockReset()
  mutateAsyncMock.mockResolvedValue({
    movementId: 'm1',
    kind: 'adjustment',
    recordedAt: '',
    lines: [{ stockAfter: 7 }],
  })
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe('AdjustStockDialog (IS-10)', () => {
  it('muestra el stock actual del artículo', () => {
    renderDialog()
    expect(
      screen.getByText(/Lavandina · 1 L \(QUI-001\)\. Hay 4 en stock\./),
    ).toBeInTheDocument()
  })

  it('sin motivo ni cantidad no registra y pide los dos', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }))
    expect(
      await screen.findByText('Elegí el motivo del ajuste.'),
    ).toBeInTheDocument()
    expect(mutateAsyncMock).not.toHaveBeenCalled()
  })

  it('con «Otro» la observación es obligatoria', async () => {
    renderDialog()
    typeQty('2')
    chooseReason('Otro')
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }))
    expect(
      await screen.findByText(
        'Con el motivo «Otro» tenés que escribir una observación.',
      ),
    ).toBeInTheDocument()
    expect(mutateAsyncMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Observación'), {
      target: { value: 'Se regaló a una escuela' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }))
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1))
    expect(mutateAsyncMock).toHaveBeenCalledWith({
      supplyId: 's1',
      delta: 2,
      reason: 'other',
      note: 'Se regaló a una escuela',
    })
  })

  it('suma con + y avisa cómo queda el stock', async () => {
    renderDialog()
    typeQty('3')
    chooseReason('Control de stock')
    expect(screen.getByText('El stock va a quedar en 7.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }))
    await waitFor(() =>
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        supplyId: 's1',
        delta: 3,
        reason: 'count',
        note: null,
      }),
    )
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        'Registramos el ajuste. El stock queda en 7.',
      ),
    )
  })

  it('resta con − (delta negativo)', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('radio', { name: 'Restar (−)' }))
    typeQty('1')
    chooseReason('Rotura')
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }))
    await waitFor(() =>
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        supplyId: 's1',
        delta: -1,
        reason: 'breakage',
        note: null,
      }),
    )
  })

  it('no deja restar más de lo que hay', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('radio', { name: 'Restar (−)' }))
    typeQty('5')
    chooseReason('Vencimiento')
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }))
    expect(
      await screen.findByText('No podés restar más de lo que hay (4).'),
    ).toBeInTheDocument()
    expect(mutateAsyncMock).not.toHaveBeenCalled()
  })

  it('un error del servidor se muestra tal cual y el diálogo no se cierra', async () => {
    const { ApiError } = await import('@/api/errors')
    mutateAsyncMock.mockRejectedValue(
      new ApiError('El artículo está desactivado.', 'SUPPLY_INACTIVE'),
    )
    renderDialog()
    typeQty('1')
    chooseReason('Error de carga')
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }))
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'El artículo está desactivado.',
      ),
    )
  })
})
