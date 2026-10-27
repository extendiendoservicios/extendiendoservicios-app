import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { StockScreen } from './StockScreen'

vi.mock('./StockTab', () => ({ StockTab: () => <p>Contenido de Stock</p> }))
vi.mock('./CategoriesTab', () => ({
  CategoriesTab: () => <p>Contenido de Categorías</p>,
}))
vi.mock('./MovementsTab', () => ({
  MovementsTab: () => <p>Contenido de Movimientos</p>,
}))
vi.mock('./ShortagesTab', () => ({
  ShortagesTab: () => <p>Contenido de Faltantes</p>,
}))
vi.mock('./ConsumptionTab', () => ({
  ConsumptionTab: () => <p>Contenido de Consumo</p>,
}))
vi.mock('./CountsTab', () => ({
  CountsTab: () => <p>Contenido de Controles</p>,
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
  it('muestra las seis pestañas en el orden de la especificación, y entra por Stock', () => {
    renderScreen()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Stock',
      'Movimientos',
      'Faltantes',
      'Consumo por cliente',
      'Controles',
      'Categorías',
    ])
    expect(screen.getByText('Contenido de Stock')).toBeInTheDocument()
  })

  it('?pestana=categorias abre Categorías', () => {
    renderScreen('/admin/insumos?pestana=categorias')
    expect(screen.getByText('Contenido de Categorías')).toBeInTheDocument()
  })

  it.each([
    ['movimientos', 'Contenido de Movimientos'],
    ['faltantes', 'Contenido de Faltantes'],
    ['consumo', 'Contenido de Consumo'],
    ['controles', 'Contenido de Controles'],
  ])('?pestana=%s abre su pestaña', (value, content) => {
    renderScreen(`/admin/insumos?pestana=${value}`)
    expect(screen.getByText(content)).toBeInTheDocument()
  })

  it('una pestaña que no existe cae en Stock', () => {
    renderScreen('/admin/insumos?pestana=inexistente')
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
