import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgendaColorPicker } from './AgendaColorPicker'

describe('AgendaColorPicker', () => {
  it('ofrece dos grupos de 20 colores, Borde y Relleno, y «Sin color»', () => {
    render(
      <AgendaColorPicker
        value={{ border: null, fill: null }}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Colores' }))
    const border = screen.getByRole('radiogroup', { name: 'Borde' })
    const fill = screen.getByRole('radiogroup', { name: 'Relleno' })
    expect(border.querySelectorAll('[role="radio"]')).toHaveLength(20)
    expect(fill.querySelectorAll('[role="radio"]')).toHaveLength(20)
    expect(screen.getAllByRole('button', { name: 'Sin color' })).toHaveLength(2)
  })

  it('cambia borde y relleno por separado', () => {
    const onChange = vi.fn()
    render(
      <AgendaColorPicker value={{ border: 0, fill: 12 }} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Colores' }))
    const border = screen.getByRole('radiogroup', { name: 'Borde' })
    fireEvent.click(border.querySelector('[aria-label="Azul"]') as Element)
    expect(onChange).toHaveBeenLastCalledWith({ border: 1, fill: 12 })
    const fill = screen.getByRole('radiogroup', { name: 'Relleno' })
    fireEvent.click(fill.querySelector('[aria-label="Rojo"]') as Element)
    expect(onChange).toHaveBeenLastCalledWith({ border: 0, fill: 0 })
  })
})
