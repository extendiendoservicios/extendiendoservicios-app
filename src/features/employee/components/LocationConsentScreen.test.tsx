import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocationConsentScreen } from './LocationConsentScreen'

/**
 * `LocationConsentScreen` (EMP-06, MOB-EMP-006): texto de reserva cuando no
 * hay uno cargado, los dos botones, y que se deshabiliten sin conexión.
 */
describe('LocationConsentScreen', () => {
  it('muestra el texto de la empresa cuando lo hay, con sus saltos de línea', () => {
    render(
      <LocationConsentScreen
        consentText={'Primer párrafo.\n\nSegundo párrafo.'}
        onAccept={() => {}}
        onSkip={() => {}}
      />,
    )

    const text = screen.getByText(/Primer párrafo\./)
    expect(text.textContent).toContain('Segundo párrafo.')
  })

  it('usa un texto de reserva si el texto de la empresa está vacío', () => {
    render(
      <LocationConsentScreen
        consentText={null}
        onAccept={() => {}}
        onSkip={() => {}}
      />,
    )

    expect(screen.getByText(/es opcional/i)).toBeInTheDocument()
  })

  it('llama a onAccept y a onSkip con cada botón', () => {
    const onAccept = vi.fn()
    const onSkip = vi.fn()
    render(
      <LocationConsentScreen
        consentText="Texto."
        onAccept={onAccept}
        onSkip={onSkip}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Aceptar y continuar' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Continuar sin ubicación' }),
    )

    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('deshabilita los dos botones sin conexión', () => {
    render(
      <LocationConsentScreen
        consentText="Texto."
        onAccept={() => {}}
        onSkip={() => {}}
        offline
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Aceptar y continuar' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Continuar sin ubicación' }),
    ).toBeDisabled()
    expect(screen.getByText(/sin conexión/i)).toBeInTheDocument()
  })
})
