import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StarRating } from './StarRating'

describe('StarRating', () => {
  it('expone el patrón ARIA radiogroup/radio con aria-checked en la estrella elegida', () => {
    render(
      <StarRating
        value={3}
        onValueChange={() => {}}
        aria-label="Calificación"
      />,
    )

    expect(
      screen.getByRole('radiogroup', { name: 'Calificación' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: '3 de 5 estrellas' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByRole('radio', { name: '4 de 5 estrellas' }),
    ).toHaveAttribute('aria-checked', 'false')
  })

  it('sin calificación todavía, ninguna estrella está marcada y el foco arranca en la primera', () => {
    render(
      <StarRating
        value={null}
        onValueChange={() => {}}
        aria-label="Calificación"
      />,
    )

    for (const label of [1, 2, 3, 4, 5]) {
      expect(
        screen.getByRole('radio', { name: `${label} de 5 estrellas` }),
      ).toHaveAttribute('aria-checked', 'false')
    }
    expect(
      screen.getByRole('radio', { name: '1 de 5 estrellas' }),
    ).toHaveAttribute('tabindex', '0')
  })

  it('un clic en una estrella informa el nuevo valor', () => {
    const handleChange = vi.fn()
    render(
      <StarRating
        value={2}
        onValueChange={handleChange}
        aria-label="Calificación"
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: '4 de 5 estrellas' }))
    expect(handleChange).toHaveBeenCalledWith(4)
  })

  it('la flecha derecha aumenta el puntaje sin dar la vuelta en el máximo', () => {
    const handleChange = vi.fn()
    render(
      <StarRating
        value={5}
        onValueChange={handleChange}
        aria-label="Calificación"
      />,
    )

    fireEvent.keyDown(screen.getByRole('radio', { name: '5 de 5 estrellas' }), {
      key: 'ArrowRight',
    })
    expect(handleChange).toHaveBeenCalledWith(5)
  })

  it('la flecha izquierda disminuye el puntaje', () => {
    const handleChange = vi.fn()
    render(
      <StarRating
        value={3}
        onValueChange={handleChange}
        aria-label="Calificación"
      />,
    )

    fireEvent.keyDown(screen.getByRole('radio', { name: '3 de 5 estrellas' }), {
      key: 'ArrowLeft',
    })
    expect(handleChange).toHaveBeenCalledWith(2)
  })

  it('Home y End van al mínimo y al máximo', () => {
    const handleChange = vi.fn()
    render(
      <StarRating
        value={3}
        onValueChange={handleChange}
        aria-label="Calificación"
      />,
    )
    const current = screen.getByRole('radio', { name: '3 de 5 estrellas' })

    fireEvent.keyDown(current, { key: 'End' })
    expect(handleChange).toHaveBeenLastCalledWith(5)

    fireEvent.keyDown(current, { key: 'Home' })
    expect(handleChange).toHaveBeenLastCalledWith(1)
  })

  it('en modo disabled no informa cambios ni permite el foco por Tab', () => {
    const handleChange = vi.fn()
    render(
      <StarRating
        value={2}
        onValueChange={handleChange}
        disabled
        aria-label="Calificación"
      />,
    )

    const star = screen.getByRole('radio', { name: '4 de 5 estrellas' })
    expect(star).toBeDisabled()
    fireEvent.click(star)
    expect(handleChange).not.toHaveBeenCalled()
  })

  it('en modo de solo lectura no expone radios, sino una imagen con el puntaje como nombre', () => {
    render(<StarRating value={4} readOnly />)

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: '4 de 5 estrellas' }),
    ).toBeInTheDocument()
  })

  it('en modo de solo lectura sin calificación, la imagen dice "Sin calificar"', () => {
    render(<StarRating value={null} readOnly />)

    expect(
      screen.getByRole('img', { name: 'Sin calificar' }),
    ).toBeInTheDocument()
  })
})
