import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { computeAttention } from '../attention'
import { computeKpis } from '../kpis'
import { NOW, makeAssignment, makeShift } from '../fixtures'
import { AttentionBlock } from './AttentionBlock'
import { DashboardKpis } from './DashboardKpis'

describe('DashboardKpis', () => {
  it('muestra los conteos en cero sin pintarlos como alarma', () => {
    const { container } = render(
      <DashboardKpis kpis={computeKpis([], [], NOW)} />,
    )
    expect(container.querySelector('.text-danger, .text-warning')).toBeNull()
    expect(screen.getAllByText('0')).toHaveLength(5)
  })
})

describe('AttentionBlock', () => {
  const shifts = [makeShift({ id: 's1' })]
  const assignments = [
    makeAssignment({ status: 'expected', displayStatus: 'no_record' }),
  ]
  const items = computeAttention(shifts, assignments, NOW)

  function renderBlock(
    overrides: Partial<Parameters<typeof AttentionBlock>[0]> = {},
  ) {
    const onRecord = vi.fn()
    const onAssign = vi.fn()
    render(
      <MemoryRouter>
        <AttentionBlock
          items={items}
          isLoading={false}
          phones={new Map([['e1', '1155550000']])}
          canRecord={() => true}
          canAssign={() => true}
          onRecord={onRecord}
          onAssign={onAssign}
          {...overrides}
        />
      </MemoryRouter>,
    )
    return { onRecord, onAssign }
  }

  it('lista la alerta con sus cuatro acciones', () => {
    const { onRecord, onAssign } = renderBlock()
    expect(
      screen.getByText(/Ana Gómez no registró el inicio/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir turno' })).toHaveAttribute(
      'href',
      '/admin/turnos/s1',
    )
    expect(screen.getByRole('link', { name: 'Llamar' })).toHaveAttribute(
      'href',
      'tel:1155550000',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Registrar en nombre' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar reemplazo' }))
    expect(onRecord).toHaveBeenCalledOnce()
    expect(onAssign).toHaveBeenCalledOnce()
  })

  it('oculta registrar y asignar sin permisos', () => {
    renderBlock({ canRecord: () => false, canAssign: () => false })
    expect(
      screen.queryByRole('button', { name: 'Registrar en nombre' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Asignar reemplazo' }),
    ).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Abrir turno' }),
    ).toBeInTheDocument()
  })

  it('sin alertas dice que todo está en orden', () => {
    renderBlock({ items: [] })
    expect(screen.getByText(/está en orden/)).toBeInTheDocument()
  })
})
