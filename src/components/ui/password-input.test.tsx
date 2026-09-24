import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PasswordInput } from './password-input'

describe('PasswordInput (P08.6)', () => {
  it('arranca oculto y el botón alterna el tipo y la etiqueta accesible', () => {
    render(<PasswordInput aria-label="Contraseña" />)

    const input = screen.getByLabelText('Contraseña')
    expect(input).toHaveAttribute('type', 'password')

    const toggle = screen.getByRole('button', { name: 'Mostrar contraseña' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle)
    expect(input).toHaveAttribute('type', 'text')
    expect(
      screen.getByRole('button', { name: 'Ocultar contraseña' }),
    ).toHaveAttribute('aria-pressed', 'true')

    // Vuelve a ocultarlo con el mismo botón (ya renombrado).
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('el botón es type="button": un click no envía el formulario que lo contiene', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput aria-label="Contraseña" />
      </form>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('reenvía la ref al input nativo', () => {
    const ref = createRef<HTMLInputElement>()
    render(<PasswordInput aria-label="Contraseña" ref={ref} />)

    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current?.type).toBe('password')
  })

  it('reenvía props nativas (autoComplete, name, disabled) sin romperlas', () => {
    render(
      <PasswordInput
        aria-label="Contraseña"
        name="password"
        autoComplete="current-password"
        disabled
      />,
    )

    const input = screen.getByLabelText('Contraseña')
    expect(input).toHaveAttribute('name', 'password')
    expect(input).toHaveAttribute('autocomplete', 'current-password')
    expect(input).toBeDisabled()
    // El botón también se deshabilita junto con el campo.
    expect(
      screen.getByRole('button', { name: 'Mostrar contraseña' }),
    ).toBeDisabled()
  })

  it('el botón apunta al input con aria-controls', () => {
    render(<PasswordInput id="mi-password" aria-label="Contraseña" />)

    const toggle = screen.getByRole('button', { name: 'Mostrar contraseña' })
    expect(toggle).toHaveAttribute('aria-controls', 'mi-password')
  })
})
