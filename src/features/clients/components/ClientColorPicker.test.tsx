import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClientColorPicker } from './ClientColorPicker'

function setup(value: number | null, onChange = vi.fn()) {
  render(
    <>
      <span id="cc-label">Color en el calendario</span>
      <ClientColorPicker id="cc" value={value} onChange={onChange} />
    </>,
  )
  return onChange
}

describe('ClientColorPicker', () => {
  it('muestra las 12 muestras como radios con el nombre del color', () => {
    setup(null)
    expect(
      screen.getByRole('radiogroup', { name: 'Color en el calendario' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(12)
    expect(screen.getByRole('radio', { name: 'Azul' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Violeta' })).toBeInTheDocument()
  })

  it('marca el elegido y avisa el índice al hacer clic', () => {
    const onChange = setup(1)
    expect(screen.getByRole('radio', { name: 'Violeta' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Naranja' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('las flechas mueven la elección', () => {
    const onChange = setup(0)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Azul' }), {
      key: 'ArrowRight',
    })
    expect(onChange).toHaveBeenCalledWith(1)
  })
})
