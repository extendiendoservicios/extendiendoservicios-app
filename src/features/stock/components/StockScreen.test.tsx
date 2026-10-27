import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { StockScreen } from './StockScreen'

vi.mock('./StockTab', () => ({ StockTab: () => <p>Contenido de Stock</p> }))
vi.mock('./CategoriesTab', () => ({
  CategoriesTab: () => <p>Contenido de Categorías</p>,
}))

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function renderScreen(entry = '/admin/insumos') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <StockScreen />
      <Location />
    </MemoryRouter>,
  )
}

describe('StockScreen (IS-33)', () => {
  it('muestra solo las pestañas Stock y Categorías, y entra por Stock', () => {
    renderScreen()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Stock',
      'Categorías',
    ])
    expect(screen.getByText('Contenido de Stock')).toBeInTheDocument()
  })

  it('?pestana=categorias abre Categorías', () => {
    renderScreen('/admin/insumos?pestana=categorias')
    expect(screen.getByText('Contenido de Categorías')).toBeInTheDocument()
  })

  it('una pestaña que todavía no existe (Movimientos) cae en Stock', () => {
    renderScreen('/admin/insumos?pestana=movimientos')
    expect(screen.getByText('Contenido de Stock')).toBeInTheDocument()
  })

  it('cambiar de pestaña actualiza la URL y quita el filtro del Resumen', () => {
    renderScreen('/admin/insumos?filtro=aviso')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Categorías' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Categorías' }))
    expect(screen.getByTestId('location')).toHaveTextContent(
      '?pestana=categorias',
    )
    expect(screen.getByTestId('location')).not.toHaveTextContent('filtro')
  })
})
