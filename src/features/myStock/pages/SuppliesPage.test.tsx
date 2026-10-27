import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SuppliesPage from './SuppliesPage'
import {
  makeShortage,
  makeSupply,
  makeWithdrawal,
  mockStockQueries,
  renderStockRoute,
} from '../testUtils'

/**
 * Insumos (P25.4, IS-20, IS-29, IS-33): catálogo sin cantidades ni precios,
 * «Sin stock», buscador y categoría, y las listas «Mis retiros» y «Mis avisos».
 */
const CATALOG = [
  makeSupply({
    id: 's1',
    code: 'QUI-001',
    name: 'Lavandina',
    presentation: '1 L',
  }),
  makeSupply({
    id: 's2',
    code: 'DES-001',
    name: 'Bolsas de residuos',
    presentation: null,
    categoryId: 'c2',
    categoryName: 'Descartables',
    categorySortOrder: 2,
    outOfStock: true,
  }),
]

function setup({
  entry = '/app/insumos',
  online = true,
  ...rest
}: Parameters<typeof mockStockQueries>[0] & { entry?: string } = {}) {
  mockStockQueries({ catalog: CATALOG, online, ...rest })
  renderStockRoute(<SuppliesPage />, { path: entry, entry })
}

afterEach(() => vi.restoreAllMocks())

describe('SuppliesPage', () => {
  it('muestra el catálogo con código, nombre y presentación, y «Sin stock» en los agotados', () => {
    setup()

    expect(screen.getByText('QUI-001')).toBeInTheDocument()
    expect(screen.getByText('Lavandina')).toBeInTheDocument()
    expect(screen.getByText('1 L')).toBeInTheDocument()
    expect(screen.getAllByText('Sin stock')).toHaveLength(1)
    // Nunca cantidades ni precios (IS-20).
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('busca por texto y filtra por categoría', () => {
    setup()

    fireEvent.change(screen.getByLabelText('Buscar insumos'), {
      target: { value: 'lavandina' },
    })
    expect(screen.getByText('Lavandina')).toBeInTheDocument()
    expect(screen.queryByText('Bolsas de residuos')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Buscar insumos'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Descartables' }))
    expect(screen.queryByText('Lavandina')).not.toBeInTheDocument()
    expect(screen.getByText('Bolsas de residuos')).toBeInTheDocument()
  })

  it('los botones llevan al retiro y al aviso de la vía del empleado', () => {
    setup()
    expect(
      screen.getByRole('link', { name: 'Retirar insumos' }),
    ).toHaveAttribute('href', '/app/insumos/retirar')
    expect(
      screen.getByRole('link', { name: 'Avisar faltante' }),
    ).toHaveAttribute('href', '/app/insumos/faltante')
  })

  it('y los de la vía del coordinador', () => {
    setup({ entry: '/sup/insumos' })
    expect(
      screen.getByRole('link', { name: 'Retirar insumos' }),
    ).toHaveAttribute('href', '/sup/insumos/retirar')
    expect(
      screen.getByRole('link', { name: 'Avisar faltante' }),
    ).toHaveAttribute('href', '/sup/insumos/faltante')
  })

  it('sin conexión avisa y deshabilita retirar y avisar', () => {
    setup({ online: false })
    expect(screen.getByText(/Estás sin conexión/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Retirar insumos' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Avisar faltante' }),
    ).toBeDisabled()
  })

  it('«Mis retiros» muestra artículos, cantidades y la marca «Anulado»', () => {
    setup({
      withdrawals: [
        makeWithdrawal({ movementId: 'm1' }),
        makeWithdrawal({
          movementId: 'm2',
          shiftId: null,
          shiftDate: null,
          startTime: null,
          note: 'Reposición de la semana',
          voidedAt: '2026-10-26T16:00:00Z',
          voidReason: 'Error de carga',
        }),
      ],
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Mis retiros' }))

    expect(screen.getAllByText(/Lavandina · 1 L/)).toHaveLength(2)
    expect(screen.getByText('Anulado')).toBeInTheDocument()
    expect(
      screen.getByText('Motivo de la anulación: Error de carga'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Turno: Limpiadora SRL · Sede Centro/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Sede: Limpiadora SRL · Sede Centro/),
    ).toBeInTheDocument()
  })

  it('«Mis retiros» vacío tiene su mensaje', () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Mis retiros' }))
    expect(screen.getByText('Todavía no retiraste insumos')).toBeInTheDocument()
  })

  it('«Mis avisos» muestra Abierto o Resuelto, con la nota de resolución', () => {
    setup({
      shortages: [
        makeShortage({ id: 'r1', status: 'open' }),
        makeShortage({
          id: 'r2',
          status: 'resolved',
          supplyName: null,
          description: 'Bolsas de 120 L',
          resolutionNote: 'Se compró',
          resolvedByName: 'Ana',
        }),
      ],
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Mis avisos' }))

    expect(screen.getByText('Abierto')).toBeInTheDocument()
    expect(screen.getByText('Resuelto')).toBeInTheDocument()
    expect(screen.getByText('Bolsas de 120 L')).toBeInTheDocument()
    expect(screen.getByText(/Respuesta: Se compró/)).toBeInTheDocument()
  })
})
