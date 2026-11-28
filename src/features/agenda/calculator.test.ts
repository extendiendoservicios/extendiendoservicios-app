import { describe, expect, it } from 'vitest'
import {
  CALC_INITIAL_STATE,
  calcActionForKey,
  calcReduce,
  type CalcAction,
  type CalcState,
} from './calculator'

/** Aplica una secuencia de teclas («2», «+», «=», «%», «C», «<») y devuelve el estado. */
function press(keys: string[]): CalcState {
  const actions: Record<string, CalcAction> = {
    '=': { type: 'equals' },
    '%': { type: 'percent' },
    C: { type: 'clear' },
    '<': { type: 'backspace' },
    ',': { type: 'decimal' },
    '+': { type: 'operator', operator: '+' },
    '-': { type: 'operator', operator: '-' },
    '×': { type: 'operator', operator: '×' },
    '÷': { type: 'operator', operator: '÷' },
  }
  return keys.reduce((state, key) => {
    const action = actions[key] ?? { type: 'digit', digit: key }
    return calcReduce(state, action)
  }, CALC_INITIAL_STATE)
}

describe('calculadora de la Agenda', () => {
  it('suma, resta, multiplica y divide', () => {
    expect(press(['2', '+', '3', '=']).display).toBe('5')
    expect(press(['9', '-', '4', '=']).display).toBe('5')
    expect(press(['6', '×', '7', '=']).display).toBe('42')
    expect(press(['8', '÷', '2', '=']).display).toBe('4')
  })

  it('usa coma decimal y no arrastra ruido de coma flotante', () => {
    expect(press(['0', ',', '1', '+', '0', ',', '2', '=']).display).toBe('0,3')
    expect(press(['1', ',', '5', '×', '2', '=']).display).toBe('3')
    expect(press([',', '5']).display).toBe('0,5')
    expect(press(['1', ',', '2', ',', '3']).display).toBe('1,23')
  })

  it('encadena las operaciones de izquierda a derecha', () => {
    expect(press(['2', '+', '3', '×', '4', '=']).display).toBe('20')
    expect(press(['2', '+', '3', '+']).display).toBe('5')
  })

  it('reemplaza el operador si se aprietan dos seguidos', () => {
    expect(press(['5', '+', '×', '2', '=']).display).toBe('10')
  })

  it('calcula el porcentaje', () => {
    expect(press(['5', '0', '%']).display).toBe('0,5')
    // 10 % de 200 sumado a 200.
    expect(press(['2', '0', '0', '+', '1', '0', '%', '=']).display).toBe('220')
    expect(press(['2', '0', '0', '×', '1', '0', '%', '=']).display).toBe('20')
  })

  it('dividir por cero muestra Error y la siguiente tecla arranca de cero', () => {
    const state = press(['5', '÷', '0', '='])
    expect(state.display).toBe('Error')
    expect(state.error).toBe(true)
    expect(calcReduce(state, { type: 'digit', digit: '7' }).display).toBe('7')
    expect(press(['5', '÷', '0', '+']).display).toBe('Error')
  })

  it('C borra todo y ← borra el último dígito', () => {
    expect(press(['1', '2', '3', 'C']).display).toBe('0')
    expect(press(['1', '2', '3', '<']).display).toBe('12')
    expect(press(['5', '<']).display).toBe('0')
    // No toca un resultado.
    expect(press(['2', '+', '2', '=', '<']).display).toBe('4')
  })

  it('después de = un dígito empieza un número nuevo', () => {
    expect(press(['2', '+', '2', '=', '7']).display).toBe('7')
  })

  it('traduce las teclas del teclado', () => {
    expect(calcActionForKey('7')).toEqual({ type: 'digit', digit: '7' })
    expect(calcActionForKey(',')).toEqual({ type: 'decimal' })
    expect(calcActionForKey('.')).toEqual({ type: 'decimal' })
    expect(calcActionForKey('*')).toEqual({ type: 'operator', operator: '×' })
    expect(calcActionForKey('/')).toEqual({ type: 'operator', operator: '÷' })
    expect(calcActionForKey('Enter')).toEqual({ type: 'equals' })
    expect(calcActionForKey('Backspace')).toEqual({ type: 'backspace' })
    expect(calcActionForKey('Escape')).toEqual({ type: 'clear' })
    expect(calcActionForKey('%')).toEqual({ type: 'percent' })
    expect(calcActionForKey('Tab')).toBeNull()
  })
})
