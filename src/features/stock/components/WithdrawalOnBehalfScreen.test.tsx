import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import type { StockItem, WithdrawalInput } from '@/api/stock'
import { mockViewport, testItem } from '@/features/stock/testSupport'
import { WithdrawalOnBehalfScreen } from './WithdrawalOnBehalfScreen'

const { authState, mutateAsyncMock, toastMock } = vi.hoisted(() => ({
  authState: { roles: ['owner'] as string[], capabilities: [] as string[] },
  mutateAsyncMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => authState }))

const ITEMS: StockItem[] = [
  testItem({ id: 's1', code: 'QUI-001', name: 'Lavandina', stockQty: 10 }),
  testItem({
    id: 's2',
    code: 'DES-010',
    name: 'Bolsa de residuos',
    presentation: 'x 10',
    stockQty: 3,
  }),
  testItem({ id: 's3', code: 'QUI-050', name: 'Sin stock', stockQty: 0 }),
  testItem({ id: 's4', code: 'QUI-099', name: 'Discontinuado', active: false }),
]

vi.mock('@/features/stock/queries', () => ({
  useStockItemsQuery: () => ({ data: ITEMS, isLoading: false }),
  useStockPeopleQuery: () => ({
    data: [
      {
        profileId: 'p1',
        firstName: 'Lucía',
        lastName: 'Pérez',
        roles: ['employee'],
      },
      {
        profileId: 'p2',
        firstName: 'Marta',
        lastName: 'Ruiz',
        roles: ['supervisor'],
      },
    ],
    isLoading: false,
  }),
  useWithdrawalShiftOptionsQuery: () => ({
    data: [
      {
        shiftId: 't1',
        shiftDate: '2026-10-26',
        startTime: '08:00:00',
        endTime: '12:00:00',
        openEnded: false,
        clientId: 'c1',
        clientName: 'Banco Sur',
        siteId: 'si1',
        siteName: 'Casa Central',
      },
    ],
  }),
  useWithdrawalSiteOptionsQuery: () => ({
    data: [
      {
        siteId: 'si1',
        siteName: 'Casa Central',
        clientId: 'c1',
        clientName: 'Banco Sur',
      },
    ],
  }),
  useRegisterWithdrawalOnBehalfMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}))

function renderScreen() {
  return render(
    <MemoryRouter>
      <WithdrawalOnBehalfScreen />
    </MemoryRouter>,
  )
}

async function pick(comboboxName: string, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }))
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
}

beforeEach(() => {
  mockViewport(true)
  Element.prototype.scrollIntoView = vi.fn()
  authState.roles = ['owner']
  authState.capabilities = []
  mutateAsyncMock.mockReset()
  toastMock.error.mockReset()
  mutateAsyncMock.mockResolvedValue({
    movementId: 'm1',
    recordedAt: '2026-10-26T17:30:00Z',
    lines: [
      {
        supplyId: 's1',
        code: 'QUI-001',
        name: 'Lavandina',
        presentation: '1 L',
        qty: 2,
      },
    ],
  })
})

describe('WithdrawalOnBehalfScreen: retiro en nombre de (IS-11, IS-12)', () => {
  it('sin «Gestionar stock» no se puede cargar un retiro a nombre de otro', () => {
    authState.roles = ['admin']
    renderScreen()
    expect(
      screen.getByText('No tenés permiso para registrar retiros'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Registrar retiro' }),
    ).toBeNull()
  })

  it('ofrece empleados y coordinadores, y solo artículos activos con stock', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('combobox', { name: 'Quién retira' }))
    expect(
      await screen.findByRole('option', { name: 'Lucía Pérez · Empleado' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Marta Ruiz · Coordinador' }),
    ).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })

    fireEvent.click(
      screen.getByRole('combobox', { name: 'Agregar un artículo' }),
    )
    expect(
      await screen.findByRole('option', { name: /QUI-001 · Lavandina/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Sin stock/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /Discontinuado/ })).toBeNull()
  })

  it('pide persona, turno y artículos antes de mandar', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar retiro' }))
    expect(await screen.findByText('Elegí quién retira.')).toBeInTheDocument()
    expect(
      screen.getByText('Elegí el turno para el que retira.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Agregá al menos un artículo.')).toBeInTheDocument()
    expect(mutateAsyncMock).not.toHaveBeenCalled()
  })

  it('con una sede, la observación es obligatoria', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('radio', { name: 'Una sede' }))
    await pick('Quién retira', 'Lucía Pérez · Empleado')
    await pick('Sede', 'Banco Sur · Casa Central')
    await pick('Agregar un artículo', /QUI-001/)
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar retiro' }))

    expect(
      await screen.findByText(
        /escribí una observación \(por ejemplo «reposición de la semana»\)/,
      ),
    ).toBeInTheDocument()
    expect(mutateAsyncMock).not.toHaveBeenCalled()
  })

  it('avisa antes de mandar si la cantidad supera el stock', async () => {
    renderScreen()
    await pick('Quién retira', 'Lucía Pérez · Empleado')
    await pick('Turno', /Banco Sur/)
    await pick('Agregar un artículo', /DES-010/)
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '4' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar retiro' }))
    expect(
      await screen.findByText('No alcanza el stock: hay 3.'),
    ).toBeInTheDocument()
    expect(mutateAsyncMock).not.toHaveBeenCalled()
  })

  it('registra el retiro en nombre de la persona elegida y muestra el resumen', async () => {
    renderScreen()
    await pick('Quién retira', 'Lucía Pérez · Empleado')
    await pick('Turno', /Banco Sur/)
    await pick('Agregar un artículo', /QUI-001/)
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText('Observación (opcional)'), {
      target: { value: 'Para el piso 3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar retiro' }))

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1))
    expect(mutateAsyncMock.mock.calls[0]?.[0]).toEqual({
      personId: 'p1',
      shiftId: 't1',
      siteId: null,
      note: 'Para el piso 3',
      lines: [{ supplyId: 's1', qty: 2 }],
    } satisfies WithdrawalInput)

    const summary = within(await screen.findByTestId('withdrawal-summary'))
    expect(summary.getByText('Retiro registrado')).toBeInTheDocument()
    expect(summary.getByText('Lucía Pérez')).toBeInTheDocument()
    expect(summary.getByText('Lavandina · 1 L')).toBeInTheDocument()
    expect(summary.getByText('2')).toBeInTheDocument()
    expect(summary.getByText('Para el piso 3')).toBeInTheDocument()
  })

  it('muestra el mensaje del servidor si el retiro falla', async () => {
    mutateAsyncMock.mockRejectedValue(
      new ApiError(
        'No alcanza el stock de Lavandina: hay 1.',
        'INSUFFICIENT_STOCK',
      ),
    )
    renderScreen()
    await pick('Quién retira', 'Lucía Pérez · Empleado')
    await pick('Turno', /Banco Sur/)
    await pick('Agregar un artículo', /QUI-001/)
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar retiro' }))
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'No alcanza el stock de Lavandina: hay 1.',
      ),
    )
  })
})
