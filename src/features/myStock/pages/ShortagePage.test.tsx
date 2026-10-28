import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShortagePage from './ShortagePage'
import {
  makeShiftOption,
  makeSupply,
  mockStockQueries,
  renderStockRoute,
} from '../testUtils'

/** Avisar faltante (P25.4, IS-29): un artículo del catálogo o texto libre, uno de los dos. */
const REPORT = {
  id: 'r1',
  status: 'open',
  createdAt: '2026-10-26T15:00:00Z',
  supplyId: 's1',
  description: null,
}

function setup({
  online = true,
  report = vi.fn().mockResolvedValue(REPORT),
}: { online?: boolean; report?: ReturnType<typeof vi.fn> } = {}) {
  mockStockQueries({
    catalog: [
      makeSupply({ id: 's1', name: 'Lavandina', presentation: '1 L' }),
      makeSupply({
        id: 's2',
        code: 'DES-001',
        name: 'Bolsas de residuos',
        presentation: null,
        outOfStock: true,
      }),
    ],
    shiftOptions: [makeShiftOption()],
    online,
    report,
  })
  renderStockRoute(<ShortagePage />, {
    path: '/app/insumos/faltante',
    entry: '/app/insumos/faltante',
  })
  return report
}

afterEach(() => vi.restoreAllMocks())

describe('ShortagePage', () => {
  it('avisa un artículo del catálogo (también uno «Sin stock») con comentario', async () => {
    const report = setup()

    fireEvent.click(screen.getByRole('button', { name: /Bolsas de residuos/ }))
    // Elegido: se muestra resumido, con «Cambiar».
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Comentario'), {
      target: { value: 'Se terminó' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }))
      await Promise.resolve()
    })

    expect(report).toHaveBeenCalledWith({
      supplyId: 's2',
      description: '',
      shiftId: '',
      siteId: '',
      comment: 'Se terminó',
    })
    expect(
      await screen.findByText(/Avisaste que falta: Bolsas/),
    ).toBeInTheDocument()
  })

  it('limita el largo de la descripción (200) y del comentario (500), como el servidor', () => {
    setup()
    expect(screen.getByLabelText('Comentario')).toHaveAttribute(
      'maxlength',
      '500',
    )
  })

  it('sin artículo ni descripción no envía', async () => {
    const report = setup()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }))
      await Promise.resolve()
    })

    expect(screen.getByText('Elegí el artículo que falta.')).toBeInTheDocument()
    expect(report).not.toHaveBeenCalled()
  })

  it('avisa con texto libre', async () => {
    const report = setup()

    fireEvent.click(screen.getByRole('radio', { name: 'Otro insumo' }))
    fireEvent.change(screen.getByLabelText('Qué insumo falta'), {
      target: { value: 'Bolsas de 120 L' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }))
      await Promise.resolve()
    })

    expect(report).toHaveBeenCalledWith({
      supplyId: '',
      description: 'Bolsas de 120 L',
      shiftId: '',
      siteId: '',
      comment: '',
    })
  })

  it('con texto libre vacío no envía', async () => {
    const report = setup()

    fireEvent.click(screen.getByRole('radio', { name: 'Otro insumo' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }))
      await Promise.resolve()
    })

    expect(
      screen.getByText(
        'Elegí un artículo del catálogo o escribí cuál es el que falta.',
      ),
    ).toBeInTheDocument()
    expect(report).not.toHaveBeenCalled()
  })

  it('el turno es opcional pero, si se elige «Un turno», hay que elegir uno', async () => {
    const report = setup()

    fireEvent.click(screen.getByRole('radio', { name: 'Otro insumo' }))
    fireEvent.change(screen.getByLabelText('Qué insumo falta'), {
      target: { value: 'Esponjas' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Un turno' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }))
      await Promise.resolve()
    })
    expect(
      screen.getByText('Elegí el turno o dejá «Ninguno».'),
    ).toBeInTheDocument()
    expect(report).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('radio', { name: /Limpiadora SRL · Sede Centro/ }),
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }))
      await Promise.resolve()
    })
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Esponjas', shiftId: 'sh1' }),
    )
  })

  it('sin conexión no deja enviar', () => {
    setup({ online: false })
    expect(screen.getByRole('button', { name: 'Enviar aviso' })).toBeDisabled()
    expect(screen.getByText(/Estás sin conexión/)).toBeInTheDocument()
  })
})
