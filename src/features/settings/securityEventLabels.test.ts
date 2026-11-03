import { describe, expect, it } from 'vitest'
import {
  SECURITY_EVENT_TYPES,
  SECURITY_EVENT_TYPE_LABELS,
  describeSecurityEventDetail,
} from './securityEventLabels'

describe('record_deleted en ADM-31 (OD-23)', () => {
  it('tiene etiqueta y está entre los tipos filtrables', () => {
    expect(SECURITY_EVENT_TYPE_LABELS.record_deleted).toBe(
      'Registro eliminado por la dirección',
    )
    expect(SECURITY_EVENT_TYPES).toContain('record_deleted')
  })

  it('muestra la entidad y el nombre', () => {
    expect(
      describeSecurityEventDetail({
        eventType: 'record_deleted',
        details: { entity: 'client', name: 'ACME SA' },
      }),
    ).toBe('Cliente «ACME SA»')
    expect(
      describeSecurityEventDetail({
        eventType: 'record_deleted',
        details: { entity: 'service_shifts', name: 'Limpieza' },
      }),
    ).toBe('Turnos de un servicio «Limpieza»')
  })

  it('tolera datos incompletos y otros tipos de evento', () => {
    expect(
      describeSecurityEventDetail({
        eventType: 'record_deleted',
        details: { entity: 'shift' },
      }),
    ).toBe('Turno')
    expect(
      describeSecurityEventDetail({
        eventType: 'record_deleted',
        details: null,
      }),
    ).toBeNull()
    expect(
      describeSecurityEventDetail({
        eventType: 'sign_in',
        details: { entity: 'client', name: 'X' },
      }),
    ).toBeNull()
  })
})
