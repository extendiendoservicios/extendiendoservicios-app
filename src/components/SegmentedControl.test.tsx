import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

const options = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
] as const

describe('SegmentedControl', () => {
  it('expone el patrón ARIA radiogroup/radio con aria-checked en la opción activa', () => {
    render(
      <SegmentedControl
        options={options}
        value="week"
        onValueChange={() => {}}
        aria-label="Vista"
      />,
    )

    expect(
      screen.getByRole('radiogroup', { name: 'Vista' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Semana' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Día' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('solo la opción seleccionada es alcanzable con Tab (foco itinerante)', () => {
    render(
      <SegmentedControl
        options={options}
        value="month"
        onValueChange={() => {}}
        aria-label="Vista"
      />,
    )

    expect(screen.getByRole('radio', { name: 'Mes' })).toHaveAttribute(
      'tabindex',
      '0',
    )
    expect(screen.getByRole('radio', { name: 'Día' })).toHaveAttribute(
      'tabindex',
      '-1',
    )
  })

  it('la flecha derecha selecciona la siguiente opción (con vuelta al principio)', () => {
    const handleChange = vi.fn()
    render(
      <SegmentedControl
        options={options}
        value="month"
        onValueChange={handleChange}
        aria-label="Vista"
      />,
    )

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Mes' }), {
      key: 'ArrowRight',
    })

    expect(handleChange).toHaveBeenCalledWith('day')
  })

  it('la flecha izquierda selecciona la opción anterior', () => {
    const handleChange = vi.fn()
    render(
      <SegmentedControl
        options={options}
        value="week"
        onValueChange={handleChange}
        aria-label="Vista"
      />,
    )

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Semana' }), {
      key: 'ArrowLeft',
    })

    expect(handleChange).toHaveBeenCalledWith('day')
  })

  it('Home y End van al primero y al último', () => {
    const handleChange = vi.fn()
    render(
      <SegmentedControl
        options={options}
        value="week"
        onValueChange={handleChange}
        aria-label="Vista"
      />,
    )
    const current = screen.getByRole('radio', { name: 'Semana' })

    fireEvent.keyDown(current, { key: 'End' })
    expect(handleChange).toHaveBeenLastCalledWith('month')

    fireEvent.keyDown(current, { key: 'Home' })
    expect(handleChange).toHaveBeenLastCalledWith('day')
  })

  it('pinta en rojo la opción crítica seleccionada', () => {
    render(
      <SegmentedControl
        options={[
          { value: 'ok', label: 'Presente' },
          { value: 'absence', label: 'Ausencia', critical: true },
        ]}
        value="absence"
        onValueChange={() => {}}
        aria-label="Estado"
      />,
    )

    expect(screen.getByRole('radio', { name: 'Ausencia' }).className).toMatch(
      /text-danger/,
    )
  })
})
