import { describe, expect, it } from 'vitest'
import {
  formatMoney,
  formatQty,
  moneyToInputText,
  parseMoney,
  parseWholeNumber,
} from './money'

describe('formatMoney (IS-34)', () => {
  it('pesos con dos decimales y separadores argentinos', () => {
    expect(formatMoney(1234.5)).toBe('$ 1.234,50')
    expect(formatMoney(0)).toBe('$ 0,00')
    expect(formatMoney(1250000)).toBe('$ 1.250.000,00')
  })

  it('usa un espacio común (no el no separable de Intl)', () => {
    expect(formatMoney(10)).not.toContain(String.fromCharCode(160))
  })
})

describe('formatQty', () => {
  it('separa los miles con punto', () => {
    expect(formatQty(1250)).toBe('1.250')
    expect(formatQty(7)).toBe('7')
  })
})

describe('parseMoney', () => {
  it.each([
    ['1234,50', 1234.5],
    ['1.234,50', 1234.5],
    ['1234.50', 1234.5],
    ['$ 1.234,5', 1234.5],
    ['1.234', 1234],
    ['0', 0],
    ['25', 25],
    ['1.250.000,00', 1250000],
    ['12,5', 12.5],
  ])('«%s» es %s', (text, expected) => {
    expect(parseMoney(text)).toBe(expected)
  })

  it.each(['', 'abc', '-5', '1,234', '1.2.3', '1,2,3', '12,', '1e3'])(
    '«%s» no es un monto válido',
    (text) => {
      expect(parseMoney(text)).toBeNull()
    },
  )
})

describe('moneyToInputText', () => {
  it('deja dos decimales con coma y sin miles', () => {
    expect(moneyToInputText(1234.5)).toBe('1234,50')
    expect(parseMoney(moneyToInputText(1234.5))).toBe(1234.5)
  })
})

describe('parseWholeNumber', () => {
  it('acepta enteros sin signo', () => {
    expect(parseWholeNumber(' 12 ')).toBe(12)
    expect(parseWholeNumber('0')).toBe(0)
  })
  it.each(['', '-1', '1,5', '1.5', 'x'])('rechaza «%s»', (text) => {
    expect(parseWholeNumber(text)).toBeNull()
  })
})
