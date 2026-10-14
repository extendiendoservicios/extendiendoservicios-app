import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AttendanceResultScreen,
  geoResultExplanation,
} from './AttendanceResultScreen'
import type { AttendanceGeo } from '@/api/attendanceGeo'

const base: AttendanceGeo = {
  status: 'valid',
  reason: null,
  distanceM: 12,
  radiusM: 150,
  overridden: false,
}

function renderResult(geo: AttendanceGeo, onContinue = vi.fn()) {
  render(
    <AttendanceResultScreen
      title="Inicio registrado"
      recordedAt="2026-10-14T11:03:00Z"
      geo={geo}
      heading={{ primary: 'Limpia Ya', secondary: 'Sede Centro' }}
      onContinue={onContinue}
    />,
  )
  return onContinue
}

/** Lo que se ve después de fichar es lo que devolvió la base (B-37), con la hora del servidor. */
describe('AttendanceResultScreen', () => {
  it('muestra la hora que devolvió la base y «Validado»', () => {
    renderResult(base)
    expect(screen.getByText('Inicio registrado')).toBeInTheDocument()
    // 11:03Z son las 08:03 en Argentina.
    expect(screen.getByText('08:03')).toBeInTheDocument()
    expect(screen.getByText('Validado')).toBeInTheDocument()
    expect(screen.getByText('Limpia Ya')).toBeInTheDocument()
  })

  it('«Fuera de zona» muestra la distancia que guardó la base', () => {
    renderResult({ ...base, status: 'outside', distanceM: 350 })
    expect(screen.getByText(/Fuera de zona/)).toHaveTextContent('350 m')
  })

  it('«Sin validar» muestra el motivo', () => {
    renderResult({
      ...base,
      status: 'unvalidated',
      reason: 'no_location',
      distanceM: null,
    })
    expect(screen.getByText(/Sin validar/)).toHaveTextContent(
      'Sin validar (sin ubicación)',
    )
  })

  it('«Validado (corregido)» sin el motivo de la administración', () => {
    renderResult({ ...base, status: 'outside', overridden: true })
    expect(screen.getByText('Validado (corregido)')).toBeInTheDocument()
    expect(screen.queryByText(/motivo/i)).not.toBeInTheDocument()
  })

  it('el botón continúa', () => {
    const onContinue = renderResult(base)
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(onContinue).toHaveBeenCalled()
  })

  it('explica cada motivo de «Sin validar»', () => {
    const unvalidated = (reason: AttendanceGeo['reason']): AttendanceGeo => ({
      ...base,
      status: 'unvalidated',
      reason,
    })
    expect(geoResultExplanation(unvalidated('no_location'))).toMatch(
      /No tuvimos tu ubicación/,
    )
    expect(geoResultExplanation(unvalidated('site_without_coords'))).toMatch(
      /sede todavía no tiene ubicación/,
    )
    expect(geoResultExplanation(unvalidated('low_accuracy'))).toMatch(
      /poco precisa/,
    )
  })
})
