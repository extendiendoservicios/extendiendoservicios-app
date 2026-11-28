/**
 * Lógica pura de la calculadora de la Agenda (AG-18): pantalla, dígitos, coma
 * decimal, + − × ÷, %, C, ← y =. No guarda nada. Funciona como una calculadora
 * de bolsillo: las operaciones se encadenan de izquierda a derecha («2 + 3 × 4»
 * da 20), y la división por cero muestra «Error».
 */
export type CalcOperator = '+' | '-' | '×' | '÷'

export interface CalcState {
  /** Lo que se ve en la pantalla (coma decimal, o «Error»). */
  display: string
  /** Valor acumulado a la izquierda del operador pendiente. */
  accumulator: number | null
  operator: CalcOperator | null
  /** El próximo dígito arranca un número nuevo. */
  fresh: boolean
  error: boolean
}

export type CalcAction =
  | { type: 'digit'; digit: string }
  | { type: 'decimal' }
  | { type: 'operator'; operator: CalcOperator }
  | { type: 'equals' }
  | { type: 'percent' }
  | { type: 'clear' }
  | { type: 'backspace' }

export const CALC_INITIAL_STATE: CalcState = {
  display: '0',
  accumulator: null,
  operator: null,
  fresh: true,
  error: false,
}

const MAX_DIGITS = 15
const ERROR_TEXT = 'Error'

const ERROR_STATE: CalcState = {
  display: ERROR_TEXT,
  accumulator: null,
  operator: null,
  fresh: true,
  error: true,
}

function parseDisplay(display: string): number {
  return Number(display.replace(',', '.'))
}

/** Número a texto con coma decimal, sin el ruido de la coma flotante (0,1 + 0,2 da 0,3). */
export function formatCalcNumber(value: number): string {
  const rounded = Number(value.toPrecision(12))
  return String(rounded).replace('.', ',')
}

function applyOperator(
  left: number,
  operator: CalcOperator,
  right: number,
): number | null {
  switch (operator) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '×':
      return left * right
    case '÷':
      return right === 0 ? null : left / right
  }
}

function resultState(
  value: number | null,
  operator: CalcOperator | null,
): CalcState {
  if (value === null || !Number.isFinite(value)) {
    return ERROR_STATE
  }
  return {
    display: formatCalcNumber(value),
    accumulator: value,
    operator,
    fresh: true,
    error: false,
  }
}

export function calcReduce(state: CalcState, action: CalcAction): CalcState {
  if (action.type === 'clear') {
    return CALC_INITIAL_STATE
  }
  // Después de un error, cualquier tecla (salvo C) arranca de cero.
  const current = state.error ? CALC_INITIAL_STATE : state

  switch (action.type) {
    case 'digit': {
      if (current.fresh) {
        return { ...current, display: action.digit, fresh: false }
      }
      if (current.display.replace(/[-,]/g, '').length >= MAX_DIGITS) {
        return current
      }
      return {
        ...current,
        display:
          current.display === '0'
            ? action.digit
            : `${current.display}${action.digit}`,
      }
    }
    case 'decimal': {
      if (current.fresh) {
        return { ...current, display: '0,', fresh: false }
      }
      if (current.display.includes(',')) {
        return current
      }
      return { ...current, display: `${current.display},` }
    }
    case 'operator': {
      // Dos operadores seguidos: se reemplaza el pendiente.
      if (current.operator && current.fresh && current.accumulator !== null) {
        return { ...current, operator: action.operator }
      }
      const value = parseDisplay(current.display)
      if (current.operator && current.accumulator !== null) {
        return resultState(
          applyOperator(current.accumulator, current.operator, value),
          action.operator,
        )
      }
      return {
        ...current,
        accumulator: value,
        operator: action.operator,
        fresh: true,
      }
    }
    case 'equals': {
      if (!current.operator || current.accumulator === null) {
        return current
      }
      const value = parseDisplay(current.display)
      const result = resultState(
        applyOperator(current.accumulator, current.operator, value),
        null,
      )
      return result.error ? result : { ...result, accumulator: null }
    }
    case 'percent': {
      const value = parseDisplay(current.display)
      // «200 + 10 %» = 10 % de 200; en × y ÷, el 10 % solo.
      const percent =
        current.operator &&
        current.accumulator !== null &&
        (current.operator === '+' || current.operator === '-')
          ? (current.accumulator * value) / 100
          : value / 100
      return {
        ...current,
        display: formatCalcNumber(percent),
        fresh: false,
      }
    }
    case 'backspace': {
      if (current.fresh) {
        return current
      }
      const next = current.display.slice(0, -1)
      return {
        ...current,
        display: next === '' || next === '-' ? '0' : next,
      }
    }
  }
}

/** La acción que corresponde a una tecla del teclado, o `null` si no hace nada. */
export function calcActionForKey(key: string): CalcAction | null {
  if (/^[0-9]$/.test(key)) {
    return { type: 'digit', digit: key }
  }
  switch (key) {
    case ',':
    case '.':
      return { type: 'decimal' }
    case '+':
      return { type: 'operator', operator: '+' }
    case '-':
      return { type: 'operator', operator: '-' }
    case '*':
    case 'x':
    case 'X':
      return { type: 'operator', operator: '×' }
    case '/':
      return { type: 'operator', operator: '÷' }
    case '=':
    case 'Enter':
      return { type: 'equals' }
    case '%':
      return { type: 'percent' }
    case 'Backspace':
      return { type: 'backspace' }
    case 'Escape':
    case 'c':
    case 'C':
      return { type: 'clear' }
    default:
      return null
  }
}
