import { describe, expect, it } from 'vitest'
import {
  addDaysToIsoDate,
  formatDateOnly,
  formatDateOnlyWithYear,
  localDateToIsoDate,
} from './dateOnly'

/**
 * `formatDateOnly`/`localDateToIsoDate` (USERS-014, USERS-016): el punto que
 * cubren estos tests es justamente el que motivó crear el archivo -- una
 * columna `date` pura no se debe formatear con la conversión de zona horaria
 * de `formatShortDate` (`src/lib/format.ts`), o el día se corre para atrás
 * (ver el comentario de cabecera de `dateOnly.ts`).
 */
describe('formatDateOnly', () => {
  it('muestra el 1 de enero como 1 de enero, no como 31 de diciembre', () => {
    expect(formatDateOnly('2026-01-01')).toBe('jue 1 ene')
  })
})

describe('formatDateOnlyWithYear', () => {
  it('agrega el año', () => {
    expect(formatDateOnlyWithYear('2026-01-01')).toBe('jue 1 ene 2026')
  })
})

describe('localDateToIsoDate', () => {
  it('arma yyyy-MM-dd a partir de los componentes locales de la fecha', () => {
    expect(localDateToIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(localDateToIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('addDaysToIsoDate', () => {
  it('suma días cruzando de mes', () => {
    expect(addDaysToIsoDate('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('resta días cruzando de año', () => {
    expect(addDaysToIsoDate('2026-01-01', -1)).toBe('2025-12-31')
  })
})
