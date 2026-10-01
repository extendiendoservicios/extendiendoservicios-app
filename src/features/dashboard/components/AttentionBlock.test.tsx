import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeAttention } from '../attention'
import { computeKpis } from '../kpis'
import { NOW, makeAssignment, makeShift } from '../fixtures'
import { AttentionBlock } from './AttentionBlock'
import { DashboardKpis } from './DashboardKpis'

/** Simula el ancho de pantalla para `useMediaQuery` (1024 px). */
function mockDesktopViewport(isDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

beforeEach(() => {
  mockDesktopViewport(true)
})

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

  describe('con más de 5 alertas', () => {
    const manyShifts = Array.from({ length: 7 }, (_, index) =>
      makeShift({ id: `s${index}` }),
    )
    const manyAssignments = manyShifts.map((shift, index) =>
      makeAssignment({
        id: `a${index}`,
        shiftId: shift.id,
        employeeId: `e${index}`,
        employeeFirstName: `Persona${index}`,
        status: 'expected',
        displayStatus: 'no_record',
      }),
    )
    const manyItems = computeAttention(manyShifts, manyAssignments, NOW)

    it('en celular muestra 5 y despliega el resto con "Ver las N"', () => {
      mockDesktopViewport(false)
      renderBlock({ items: manyItems })
      expect(screen.getAllByText(/no registró el inicio/)).toHaveLength(5)
      fireEvent.click(screen.getByRole('button', { name: 'Ver las 7' }))
      expect(screen.getAllByText(/no registró el inicio/)).toHaveLength(7)
      expect(
        screen.getByRole('button', { name: 'Ver menos' }),
      ).toBeInTheDocument()
    })

    it('en escritorio muestra todas, sin botón', () => {
      renderBlock({ items: manyItems })
      expect(screen.getAllByText(/no registró el inicio/)).toHaveLength(7)
      expect(screen.queryByRole('button', { name: /Ver las/ })).toBeNull()
    })
  })

  it('sin alertas dice que todo está en orden', () => {
    renderBlock({ items: [] })
    expect(screen.getByText(/está en orden/)).toBeInTheDocument()
  })
})
