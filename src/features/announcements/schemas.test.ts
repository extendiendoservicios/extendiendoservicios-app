import { describe, expect, it } from 'vitest'
import {
  announcementValuesToInput,
  createAnnouncementFormSchema,
  type AnnouncementFormValues,
} from './schemas'

const TODAY = '2026-10-10'
const schema = createAnnouncementFormSchema({ today: TODAY })

const VALID: AnnouncementFormValues = {
  title: 'Reunión general',
  body: 'Nos vemos el viernes.',
  audience: 'employees',
  visibleUntil: '',
  recipientIds: [],
}

function firstMessage(values: AnnouncementFormValues): string | undefined {
  const result = schema.safeParse(values)
  return result.success ? undefined : result.error.issues[0]?.message
}

describe('esquema del formulario de anuncios', () => {
  it('acepta un anuncio válido sin fecha', () => {
    expect(schema.safeParse(VALID).success).toBe(true)
  })

  it('exige título y texto', () => {
    expect(firstMessage({ ...VALID, title: '   ' })).toBe('Escribí el título.')
    expect(firstMessage({ ...VALID, body: '' })).toBe(
      'Escribí el texto del anuncio.',
    )
  })

  it('respeta los máximos de 120 y 2000 caracteres', () => {
    expect(schema.safeParse({ ...VALID, title: 'a'.repeat(120) }).success).toBe(
      true,
    )
    expect(firstMessage({ ...VALID, title: 'a'.repeat(121) })).toContain('120')
    expect(schema.safeParse({ ...VALID, body: 'a'.repeat(2000) }).success).toBe(
      true,
    )
    expect(firstMessage({ ...VALID, body: 'a'.repeat(2001) })).toContain('2000')
  })

  it('«Elegir personas» necesita al menos una', () => {
    expect(firstMessage({ ...VALID, audience: 'custom' })).toBe(
      'Elegí al menos una persona.',
    )
    expect(
      schema.safeParse({ ...VALID, audience: 'custom', recipientIds: ['p1'] })
        .success,
    ).toBe(true)
  })

  it('no admite una fecha «hasta» pasada, pero sí hoy', () => {
    expect(firstMessage({ ...VALID, visibleUntil: '2026-10-09' })).toContain(
      'anterior a hoy',
    )
    expect(schema.safeParse({ ...VALID, visibleUntil: TODAY }).success).toBe(
      true,
    )
  })

  it('al editar, una fecha pasada que no cambió no se marca', () => {
    const editing = createAnnouncementFormSchema({
      today: TODAY,
      originalVisibleUntil: '2026-10-01',
    })
    expect(
      editing.safeParse({ ...VALID, visibleUntil: '2026-10-01' }).success,
    ).toBe(true)
    expect(
      editing.safeParse({ ...VALID, visibleUntil: '2026-10-02' }).success,
    ).toBe(false)
  })
})

describe('announcementValuesToInput', () => {
  it('recorta, pasa la fecha vacía a null y limpia destinatarios fuera de custom', () => {
    expect(
      announcementValuesToInput({
        ...VALID,
        title: '  Hola ',
        recipientIds: ['p1'],
      }),
    ).toEqual({
      title: 'Hola',
      body: 'Nos vemos el viernes.',
      audience: 'employees',
      visibleUntil: null,
      recipientIds: [],
    })
  })

  it('en custom conserva las personas y la fecha', () => {
    const input = announcementValuesToInput({
      ...VALID,
      audience: 'custom',
      recipientIds: ['p1', 'p2'],
      visibleUntil: '2026-11-01',
    })
    expect(input.recipientIds).toEqual(['p1', 'p2'])
    expect(input.visibleUntil).toBe('2026-11-01')
  })
})
