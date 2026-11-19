import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DatePicker } from './DatePicker'

const FECHA = new Date(2026, 10, 18)

describe('DatePicker — clearable (OH-12)', () => {
  it('sin clearable no hay ✕ ni botón de borrar', () => {
    render(
      <DatePicker value={FECHA} onValueChange={vi.fn()} aria-label="Hasta" />,
    )
    expect(screen.queryByRole('button', { name: /Borrar la fecha/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hasta' }))
    expect(screen.queryByRole('button', { name: 'Borrar fecha' })).toBeNull()
  })

  it('con fecha, la ✕ de la casilla la borra', () => {
    const onValueChange = vi.fn()
    render(
      <DatePicker
        clearable
        value={FECHA}
        onValueChange={onValueChange}
        aria-label="Hasta"
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Borrar la fecha: Hasta' }),
    )
    expect(onValueChange).toHaveBeenCalledWith(undefined)
  })

  it('sin fecha no se muestra la ✕', () => {
    render(<DatePicker clearable onValueChange={vi.fn()} aria-label="Hasta" />)
    expect(screen.queryByRole('button', { name: /Borrar la fecha/ })).toBeNull()
  })

  it('el desplegable trae el botón con el texto configurable y borra la fecha', () => {
    const onValueChange = vi.fn()
    render(
      <DatePicker
        clearable
        clearLabel="Sin fecha de fin"
        value={FECHA}
        onValueChange={onValueChange}
        aria-label="Hasta"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hasta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sin fecha de fin' }))
    expect(onValueChange).toHaveBeenCalledWith(undefined)
  })

  it('el texto por defecto es «Borrar fecha»', () => {
    render(
      <DatePicker
        clearable
        value={FECHA}
        onValueChange={vi.fn()}
        aria-label="Hasta"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hasta' }))
    expect(
      screen.getByRole('button', { name: 'Borrar fecha' }),
    ).toBeInTheDocument()
  })

  it('deshabilitado no muestra la ✕', () => {
    render(
      <DatePicker
        clearable
        disabled
        value={FECHA}
        onValueChange={vi.fn()}
        aria-label="Hasta"
      />,
    )
    expect(screen.queryByRole('button', { name: /Borrar la fecha/ })).toBeNull()
  })
})
