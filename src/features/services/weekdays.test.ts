import { describe, expect, it } from 'vitest'
import { formatWeekdays } from './weekdays'

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
