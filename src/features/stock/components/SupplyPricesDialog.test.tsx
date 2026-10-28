import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testItem } from '@/features/stock/testSupport'
import { SupplyPricesDialog } from './SupplyPricesDialog'

const { mutateAsyncMock, toastMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/features/stock/queries', () => ({
  useSetSupplyPricesMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}))

const ITEM = testItem({ costPrice: 1250.5, salePrice: 1800 })

beforeEach(() => {
  mutateAsyncMock.mockReset()
  mutateAsyncMock.mockResolvedValue(undefined)
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  toastMock.info.mockReset()
})

function renderDialog() {
  return render(<SupplyPricesDialog item={ITEM} open onOpenChange={() => {}} />)
}

describe('SupplyPricesDialog (IS-06, IS-22)', () => {
  it('precarga los precios vigentes con dos decimales', () => {
    renderDialog()
    expect(screen.getByLabelText('Precio de costo ($)')).toHaveValue('1250,50')
    expect(screen.getByLabelText('Precio de venta ($)')).toHaveValue('1800,00')
  })

  it('si no cambió nada, avisa y no llama al servidor', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precios' }))
    await waitFor(() => expect(toastMock.info).toHaveBeenCalledTimes(1))
    expect(mutateAsyncMock).not.toHaveBeenCalled()
  })

  it('guarda los precios nuevos como números', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('Precio de costo ($)'), {
      target: { value: '1.300,25' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precios' }))
    await waitFor(() =>
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        supplyId: 's1',
        costPrice: 1300.25,
        salePrice: 1800,
      }),
    )
  })

  it('rechaza un precio negativo', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('Precio de venta ($)'), {
      target: { value: '-10' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precios' }))
    expect(
      await screen.findByText(/Escribí un monto válido/),
    ).toBeInTheDocument()
    expect(mutateAsyncMock).not.toHaveBeenCalled()
  })
})
