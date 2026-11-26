import { describe, expect, it } from 'vitest'
import { newShiftFromEmployeePath, safeReturnPath } from './returnPath'

describe('safeReturnPath (P33.1, D-04)', () => {
  it('acepta direcciones de la ficha de un empleado', () => {
    const path = '/admin/empleados/abc?pestana=calendario&mes=2026-11'
    expect(safeReturnPath(path)).toBe(path)
  })

  it.each([
    null,
    undefined,
    '',
    '/admin/planificacion',
    '/admin/empleados',
    'https://malo.com/admin/empleados/x',
    '//malo.com/admin/empleados/x',
    '/admin/empleados//malo.com',
    '/admin/empleados/x\\y',
    'javascript:alert(1)',
  ])('ignora %s', (raw) => {
    expect(safeReturnPath(raw)).toBeNull()
  })
})

describe('newShiftFromEmployeePath', () => {
  it('arma el enlace con fecha, empleado y vuelta con el mes', () => {
    const link = newShiftFromEmployeePath({
      date: '2026-11-10',
      profileId: 'p1',
      pathname: '/admin/empleados/p1',
      search: '?pestana=calendario',
      monthKey: '2026-11',
    })
    const [path, query] = link.split('?')
    expect(path).toBe('/admin/turnos/nuevo')
    const params = new URLSearchParams(query)
    expect(params.get('fecha')).toBe('2026-11-10')
    expect(params.get('empleado')).toBe('p1')
    expect(safeReturnPath(params.get('volver'))).toBe(
      '/admin/empleados/p1?pestana=calendario&mes=2026-11',
    )
  })
})
