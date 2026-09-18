import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WeekdayPicker } from './WeekdayPicker'

describe('WeekdayPicker', () => {
  it('muestra los siete días en orden L M M J V S D', () => {
    render(<WeekdayPicker value={[]} onValueChange={() => {}} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      'L',
      'M',
      'M',
      'J',
      'V',
      'S',
      'D',
    ])
  })

  it('0 es domingo: elegir "D" agrega 0 al valor', () => {
    const handleChange = vi.fn()
    render(<WeekdayPicker value={[]} onValueChange={handleChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Domingo' }))

    expect(handleChange).toHaveBeenCalledWith([0])
  })

  it('vuelve a quitar un día ya seleccionado', () => {
    const handleChange = vi.fn()
    render(<WeekdayPicker value={[1, 3]} onValueChange={handleChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Lunes' }))

    expect(handleChange).toHaveBeenCalledWith([3])
  })

  it('marca aria-pressed en los días seleccionados y no en los demás', () => {
    render(<WeekdayPicker value={[0, 6]} onValueChange={() => {}} />)

    expect(screen.getByRole('button', { name: 'Sábado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Domingo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Lunes' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
