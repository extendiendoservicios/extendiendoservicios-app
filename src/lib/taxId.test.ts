import { describe, expect, it } from 'vitest'
import { cleanTaxId, formatTaxId, formatTaxIdWhileTyping } from './taxId'

describe('formatTaxId', () => {
  it('formatea 11 dígitos como XX-XXXXXXXX-X', () => {
    expect(formatTaxId('20123456783')).toBe('20-12345678-3')
  })
  it('acepta un valor que ya trae guiones o puntos', () => {
    expect(formatTaxId('20-12345678-3')).toBe('20-12345678-3')
    expect(formatTaxId('20.12345678.3')).toBe('20-12345678-3')
  })
  it('devuelve tal cual lo que no tiene 11 dígitos', () => {
    expect(formatTaxId('2012345')).toBe('2012345')
    expect(formatTaxId('201234567831')).toBe('201234567831')
    expect(formatTaxId('abc')).toBe('abc')
  })
  it('conserva null y undefined', () => {
    expect(formatTaxId(null)).toBeNull()
    expect(formatTaxId(undefined)).toBeNull()
  })
})

describe('formatTaxIdWhileTyping', () => {
  it('agrupa de a poco', () => {
    expect(formatTaxIdWhileTyping('2')).toBe('2')
    expect(formatTaxIdWhileTyping('20')).toBe('20')
    expect(formatTaxIdWhileTyping('201')).toBe('20-1')
    expect(formatTaxIdWhileTyping('2012345678')).toBe('20-12345678')
    expect(formatTaxIdWhileTyping('20123456783')).toBe('20-12345678-3')
  })
  it('descarta lo que sobra y lo que no es número', () => {
    expect(formatTaxIdWhileTyping('20-1234567831x9')).toBe('20-12345678-3')
  })
})

describe('cleanTaxId', () => {
  it('deja solo dígitos', () => {
    expect(cleanTaxId('20-12345678-3')).toBe('20123456783')
  })
})
