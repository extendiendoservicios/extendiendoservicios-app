import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShortageReport } from '@/api/stock'
import { testShortage } from '@/features/stock/movementFixtures'
import { ShortagesTab } from './ShortagesTab'

const { reportsState, resolveMutate } = vi.hoisted(() => ({
  reportsState: { data: [] as ShortageReport[] },
  resolveMutate: vi.fn(),
}))

vi.mock('@/features/stock/queries', () => ({
  useShortageReportsQuery: () => ({
    data: reportsState.data,
    isLoading: false,
    dataUpdatedAt: 0,
  }),
  useResolveShortageMutation: () => ({
    mutate: resolveMutate,
    isPending: false,
  }),
}))

// Resolver no depende de `manage_stock` (IS-21): la pestaña ni siquiera lee la sesión.
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['admin'], capabilities: [] }),
}))

function renderTab() {
  return render(
    <MemoryRouter>
      <ShortagesTab />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  reportsState.data = []
  resolveMutate.mockReset()
})

describe('ShortagesTab: avisos de faltante (IS-29, IS-30)', () => {
  it('muestra quién avisó, cuándo, el artículo, el turno o la sede y el comentario', () => {
    reportsState.data = [
      testShortage({
        comment: 'Queda un solo bidón',
        shiftId: 't1',
        shiftDate: '2026-10-26',
        startTime: '08:00:00',
        endTime: '12:00:00',
        clientName: 'Banco Sur',
        siteName: 'Casa Central',
      }),
    ]
    renderTab()
    const card = within(screen.getByTestId('shortage-card'))
    expect(card.getByRole('link', { name: 'Lavandina · 1 L' })).toHaveAttribute(
      'href',
      '/admin/insumos/s1',
    )
    expect(card.getByText('Abierto')).toBeInTheDocument()
    expect(
      card.getByText(/Avisó Lucía Pérez · dom 25 oct, 10:00/),
    ).toBeInTheDocument()
    expect(
      card.getByText('Banco Sur · Casa Central · lun 26 oct 08:00 a 12:00'),
    ).toBeInTheDocument()
    expect(card.getByText('Queda un solo bidón')).toBeInTheDocument()
    expect(screen.getByText('1 aviso abierto.')).toBeInTheDocument()
  })

  it('un aviso de texto libre muestra la descripción y aclara que no está en el catálogo', () => {
    reportsState.data = [
      testShortage({
        supplyId: null,
        supplyCode: null,
        supplyName: null,
        supplyPresentation: null,
        description: 'Guantes de látex talle M',
      }),
    ]
    renderTab()
    expect(screen.getByText('Guantes de látex talle M')).toBeInTheDocument()
    expect(screen.getByText('No está en el catálogo')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Guantes/ })).toBeNull()
  })

  it('los resueltos muestran quién, cuándo y la nota, y ya no ofrecen «Resolver»', () => {
    reportsState.data = [
      testShortage({
        id: 'r2',
        status: 'resolved',
        resolvedAt: '2026-10-26T12:00:00Z',
        resolvedByName: 'Ana Gómez',
        resolutionNote: 'Se compró',
      }),
    ]
    renderTab()
    expect(screen.getByText('Resuelto')).toBeInTheDocument()
    expect(
      screen.getByText('Resolvió Ana Gómez · lun 26 oct, 09:00: Se compró'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resolver/ })).toBeNull()
    expect(screen.getByText('No hay avisos abiertos.')).toBeInTheDocument()
  })

  it('«Resolver» pide una nota obligatoria y resuelve aunque no haya «Gestionar stock»', async () => {
    reportsState.data = [testShortage()]
    renderTab()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Resolver el aviso de Lavandina · 1 L',
      }),
    )
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Resolver' })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Nota de resolución'), {
      target: { value: ' Hay en el depósito ' },
    })
    fireEvent.click(confirm)
    expect(resolveMutate).toHaveBeenCalledTimes(1)
    expect(resolveMutate.mock.calls[0]?.[0]).toEqual({
      reportId: 'r1',
      note: 'Hay en el depósito',
    })
  })

  it('sin avisos muestra un mensaje en español', () => {
    renderTab()
    expect(
      screen.getByText('Todavía no hay avisos de faltante'),
    ).toBeInTheDocument()
  })
})
