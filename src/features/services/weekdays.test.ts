import { describe, expect, it } from 'vitest'
import { formatServiceDays, formatWeekdays } from './weekdays'

describe('formatWeekdays', () => {
  it('de lunes a viernes se muestra como un rango', () => {
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe('lun a vie')
  })

  it('los 7 días se muestran como "Todos los días"', () => {
    expect(formatWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('Todos los días')
  })

  it('sábado y domingo sueltos (no consecutivos en el orden de exhibición) se listan aparte', () => {
    expect(formatWeekdays([0, 6])).toBe('sáb, dom')
  })

  it('un solo día se muestra solo', () => {
    expect(formatWeekdays([3])).toBe('mié')
  })

  it('dos días consecutivos se listan con coma, no con "a"', () => {
    expect(formatWeekdays([1, 2])).toBe('lun, mar')
  })

  it('un rango largo que sigue hasta el sábado', () => {
    expect(formatWeekdays([1, 2, 3, 4, 5, 6])).toBe('lun a sáb')
  })

  it('domingo y lunes no son consecutivos en el orden de exhibición (domingo al final)', () => {
    // Orden de exhibición: lun, mar, mié, jue, vie, sáb, dom -- domingo
    // queda último, así que domingo y lunes se listan aparte, en ese orden
    // (lunes primero, por el orden de exhibición).
    expect(formatWeekdays([0, 1])).toBe('lun, dom')
  })
})

describe('formatServiceDays', () => {
  it('sin semanas es igual a formatWeekdays', () => {
    expect(formatServiceDays([1, 2, 3, 4, 5], null)).toBe('lun a vie')
    expect(formatServiceDays([1, 2, 3, 4, 5])).toBe('lun a vie')
  })

  it('un día con dos semanas', () => {
    expect(formatServiceDays([1], [1, 2])).toBe(
      'lun · 1.ª y 2.ª semana del mes',
    )
  })

  it('dos días con la última semana', () => {
    expect(formatServiceDays([2, 4], [5])).toBe(
      'mar y jue · última semana del mes',
    )
  })

  it('ordena las semanas y deja "última" al final', () => {
    expect(formatServiceDays([1], [5, 1, 3])).toBe(
      'lun · 1.ª, 3.ª y última semana del mes',
    )
  })

  it('un rango de días con semanas', () => {
    expect(formatServiceDays([1, 2, 3], [1])).toBe(
      'lun a mié · 1.ª semana del mes',
    )
  })
})
