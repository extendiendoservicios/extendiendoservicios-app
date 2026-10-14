import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AttendanceMarkRow } from './AttendanceMarkRow'
import type { AttendanceGeo } from '@/api/attendanceGeo'

const geo = (overrides: Partial<AttendanceGeo>): AttendanceGeo => ({
  status: 'valid',
  reason: null,
  distanceM: 20,
  radiusM: 150,
  overridden: false,
  ...overrides,
})

/** Historial del empleado (B-19, B-28): estado de cada fichaje y marca «Corregido» sin motivo. */
describe('AttendanceMarkRow', () => {
  it('muestra la hora y el estado de la validación', () => {
    render(
      <AttendanceMarkRow
        label="Inicio"
        at="2026-10-14T11:03:00Z"
        geo={geo({ status: 'outside' })}
      />,
    )
    expect(screen.getByText('Inicio 08:03')).toBeInTheDocument()
    expect(screen.getByText('Fuera de zona')).toBeInTheDocument()
  })

  it('marca «Corregido» cuando la administración cambió la hora, sin motivo', () => {
    render(
      <AttendanceMarkRow
        label="Fin"
        at="2026-10-14T15:00:00Z"
        geo={geo({})}
        timeCorrected
      />,
    )
    expect(screen.getByText('Corregido')).toBeInTheDocument()
    expect(screen.getByText('Validado')).toBeInTheDocument()
  })

  it('«Validado (corregido)» cuando la administración marcó el fichaje como válido', () => {
    render(
      <AttendanceMarkRow
        label="Inicio"
        at="2026-10-14T11:03:00Z"
        geo={geo({ status: 'outside', overridden: true })}
      />,
    )
    expect(screen.getByText('Validado (corregido)')).toBeInTheDocument()
  })

  it('«Sin validar» con el motivo', () => {
    render(
      <AttendanceMarkRow
        label="Inicio"
        at="2026-10-14T11:03:00Z"
        geo={geo({
          status: 'unvalidated',
          reason: 'admin_record',
          distanceM: null,
        })}
      />,
    )
    expect(
      screen.getByText('Sin validar (registrado por la administración)'),
    ).toBeInTheDocument()
  })

  it('sin fichaje no muestra nada', () => {
    const { container } = render(
      <AttendanceMarkRow label="Fin" at={null} geo={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('sin validación guardada muestra solo la hora', () => {
    render(<AttendanceMarkRow label="Inicio" at="2026-10-14T11:03:00Z" />)
    expect(screen.getByText('Inicio 08:03')).toBeInTheDocument()
    expect(screen.queryByText(/Validado|zona|validar/)).not.toBeInTheDocument()
  })
})
