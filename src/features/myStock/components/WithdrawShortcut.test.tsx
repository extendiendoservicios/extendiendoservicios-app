import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WithdrawShortcut } from './WithdrawShortcut'
import {
  makeShiftOption,
  mockStockQueries,
  renderStockRoute,
} from '../testUtils'

/** Atajo «Retirar insumos» del servicio (IS-28): solo si el turno está entre las opciones permitidas. */
afterEach(() => vi.restoreAllMocks())

describe('WithdrawShortcut', () => {
  it('abre el retiro con el turno ya elegido', () => {
    mockStockQueries({ shiftOptions: [makeShiftOption({ shiftId: 'sh1' })] })
    renderStockRoute(<WithdrawShortcut shiftId="sh1" base="/app" />, {
      path: '/',
      entry: '/',
    })
    expect(
      screen.getByRole('link', { name: 'Retirar insumos' }),
    ).toHaveAttribute('href', '/app/insumos/retirar?turno=sh1')
  })

  it('en la vía del coordinador apunta a /sup', () => {
    mockStockQueries({ shiftOptions: [makeShiftOption({ shiftId: 'sh1' })] })
    renderStockRoute(<WithdrawShortcut shiftId="sh1" base="/sup" />, {
      path: '/',
      entry: '/',
    })
    expect(
      screen.getByRole('link', { name: 'Retirar insumos' }),
    ).toHaveAttribute('href', '/sup/insumos/retirar?turno=sh1')
  })

  it('si el turno no está entre las opciones, no se muestra', () => {
    mockStockQueries({ shiftOptions: [makeShiftOption({ shiftId: 'otro' })] })
    renderStockRoute(<WithdrawShortcut shiftId="sh1" base="/app" />, {
      path: '/',
      entry: '/',
    })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
